const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ════════════════════════════════════════════════════════════
//  DATABASE
// ════════════════════════════════════════════════════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', s).update(password).digest('hex');
  return { hash, salt: s };
}
function verifyPassword(password, hash, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex') === hash;
}

const sessions = new Map();
function createSession(accountId, username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { accountId, username, role, createdAt: Date.now() });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > 86400000) { sessions.delete(token); return null; }
  return s;
}
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.session = session;
  next();
}
function requireSuperadmin(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  if (session.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin access required' });
  req.session = session;
  next();
}

async function initDB() {
  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hud_readings (
      id          SERIAL PRIMARY KEY,
      recorded_at TIMESTAMP DEFAULT NOW(),
      temp        REAL, hum REAL, dist REAL,
      risk        INTEGER, status TEXT, tof_ok BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS thermal_readings (
      id          SERIAL PRIMARY KEY,
      recorded_at TIMESTAMP DEFAULT NOW(),
      min_temp    REAL, max_temp REAL, cross_temp REAL,
      status      TEXT, human BOOLEAN, fire BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS devices (
      id            SERIAL PRIMARY KEY,
      device_id     TEXT UNIQUE NOT NULL,
      device_name   TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      last_seen     TIMESTAMP,
      created_at    TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS alert_logs (
      id          SERIAL PRIMARY KEY,
      recorded_at TIMESTAMP DEFAULT NOW(),
      alert_type  TEXT NOT NULL,
      device_id   TEXT,
      temp        REAL, hum REAL, risk INTEGER,
      min_temp    REAL, max_temp REAL, cross_temp REAL,
      details     TEXT
    );
    CREATE TABLE IF NOT EXISTS invite_codes (
      id         SERIAL PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      used       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Add role column if it doesn't exist (migration for existing databases)
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
  `).catch(() => {});

  // Seed default admin account
  const acc = await pool.query("SELECT id FROM accounts WHERE username='admin' LIMIT 1");
  if (acc.rows.length === 0) {
    const { hash, salt } = hashPassword('admin123');
    await pool.query(
      "INSERT INTO accounts (username,password_hash,password_salt,role) VALUES ($1,$2,$3,'admin')",
      ['admin', hash, salt]
    );
    console.log('✅ Default account: admin / admin123');
  }

  // Seed superadmin account
  const sa = await pool.query("SELECT id FROM accounts WHERE username='superadmin' LIMIT 1");
  if (sa.rows.length === 0) {
    const { hash, salt } = hashPassword('superadmin123');
    await pool.query(
      "INSERT INTO accounts (username,password_hash,password_salt,role) VALUES ($1,$2,$3,'superadmin')",
      ['superadmin', hash, salt]
    );
    console.log('✅ Superadmin account: superadmin / superadmin123');
  } else {
    // Ensure existing superadmin row has correct role
    await pool.query("UPDATE accounts SET role='superadmin' WHERE username='superadmin'");
  }

  // Seed default device
  const dev = await pool.query('SELECT id FROM devices LIMIT 1');
  if (dev.rows.length === 0) {
    const { hash, salt } = hashPassword('esp32pass');
    await pool.query(
      'INSERT INTO devices (device_id,device_name,password_hash,password_salt) VALUES ($1,$2,$3,$4)',
      ['ESP32-001', 'Main Sensor Unit', hash, salt]
    );
    console.log('✅ Default device: ESP32-001 / esp32pass');
  }

  console.log('✅ Database tables ready');
}

initDB().catch(err => console.error('❌ DB init error:', err.message));
pool.query('SELECT NOW()').then(r => console.log('✅ DB connected:', r.rows[0].now)).catch(e => console.error('❌ DB connection failed:', e.message));

let latestData = {
  hud: { temp:0, hum:0, dist:0, risk:0, status:'WAITING', tofOK:false, ts:0 },
  thermal: { linked:false, minTemp:0, maxTemp:0, crossTemp:0, status:'NO LINK', humanDetected:false, fireDetected:false, ageMs:99999 }
};

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const r = await pool.query('SELECT * FROM accounts WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const acc = r.rows[0];
    if (!verifyPassword(password, acc.password_hash, acc.password_salt))
      return res.status(401).json({ error: 'Invalid username or password' });
    const role  = acc.role || 'admin';
    const token = createSession(acc.id, acc.username, role);
    res.json({ ok: true, token, username: acc.username, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  try {
    const r = await pool.query('SELECT * FROM accounts WHERE id=$1', [req.session.accountId]);
    const acc = r.rows[0];
    if (!verifyPassword(currentPassword, acc.password_hash, acc.password_salt))
      return res.status(401).json({ error: 'Current password is incorrect' });
    const { hash, salt } = hashPassword(newPassword);
    await pool.query('UPDATE accounts SET password_hash=$1,password_salt=$2 WHERE id=$3', [hash, salt, acc.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/devices', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,device_id,device_name,last_seen,created_at FROM devices ORDER BY id');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/device/change-password', requireAuth, async (req, res) => {
  const { deviceId, newPassword } = req.body;
  if (!deviceId || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  try {
    const { hash, salt } = hashPassword(newPassword);
    const r = await pool.query('UPDATE devices SET password_hash=$1,password_salt=$2 WHERE device_id=$3 RETURNING id', [hash, salt, deviceId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  SUPERADMIN — USER MANAGEMENT ROUTES
// ════════════════════════════════════════════════════════════

// GET all users
app.get('/api/admin/users', requireSuperadmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, role, created_at FROM accounts ORDER BY id ASC'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create user
app.post('/api/admin/users', requireSuperadmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  const safeRole = (role === 'superadmin') ? 'superadmin' : 'admin';
  try {
    const { hash, salt } = hashPassword(password);
    const r = await pool.query(
      'INSERT INTO accounts (username,password_hash,password_salt,role) VALUES ($1,$2,$3,$4) RETURNING id,username,role,created_at',
      [username, hash, salt, safeRole]
    );
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT update user
app.put('/api/admin/users/:id', requireSuperadmin, async (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required' });
  const safeRole = (role === 'superadmin') ? 'superadmin' : 'admin';

  // Prevent downgrading yourself
  if (parseInt(id) === req.session.accountId && safeRole !== 'superadmin') {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  try {
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
      const { hash, salt } = hashPassword(password);
      await pool.query(
        'UPDATE accounts SET username=$1,password_hash=$2,password_salt=$3,role=$4 WHERE id=$5',
        [username, hash, salt, safeRole, id]
      );
    } else {
      await pool.query(
        'UPDATE accounts SET username=$1,role=$2 WHERE id=$3',
        [username, safeRole, id]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE user
app.delete('/api/admin/users/:id', requireSuperadmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.accountId)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const r = await pool.query('DELETE FROM accounts WHERE id=$1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    // Invalidate all sessions for this user
    for (const [token, s] of sessions.entries()) {
      if (s.accountId === parseInt(id)) sessions.delete(token);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET superadmin stats
app.get('/api/admin/stats', requireSuperadmin, async (req, res) => {
  try {
    const [usersR, devicesR] = await Promise.all([
      pool.query('SELECT role FROM accounts'),
      pool.query('SELECT COUNT(*) FROM devices')
    ]);
    const totalUsers     = usersR.rows.length;
    const adminCount     = usersR.rows.filter(r => r.role === 'admin').length;
    const activeSessions = sessions.size;
    const deviceCount    = parseInt(devicesR.rows[0].count);
    res.json({ totalUsers, adminCount, activeSessions, deviceCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  INVITE CODES (superadmin only)
// ════════════════════════════════════════════════════════════

// Generate invite code
app.post('/api/invite-codes', requireSuperadmin, async (req, res) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const code = 'LX-' + suffix;
  try {
    await pool.query(
      'INSERT INTO invite_codes (code, created_by) VALUES ($1,$2)',
      [code, req.session.accountId]
    );
    res.json({ code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List unused codes
app.get('/api/invite-codes', requireSuperadmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT code, created_at FROM invite_codes WHERE used=FALSE ORDER BY created_at DESC'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Void / delete a code
app.delete('/api/invite-codes/:code', requireSuperadmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM invite_codes WHERE code=$1 AND used=FALSE',
      [req.params.code]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  REGISTER WITH INVITE CODE (public)
// ════════════════════════════════════════════════════════════
app.post('/api/register', async (req, res) => {
  const { username, password, inviteCode } = req.body;
  if (!username || !password || !inviteCode)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password min 6 characters' });
  try {
    // Validate invite code
    const codeRow = await pool.query(
      'SELECT * FROM invite_codes WHERE code=$1 AND used=FALSE',
      [inviteCode]
    );
    if (!codeRow.rows.length)
      return res.status(400).json({ error: 'Invalid or expired invite code' });

    // Create user
    const { hash, salt } = hashPassword(password);
    await pool.query(
      'INSERT INTO accounts (username,password_hash,password_salt,role) VALUES ($1,$2,$3,$4)',
      [username, hash, salt, 'admin']
    );

    // Mark code as used
    await pool.query('UPDATE invite_codes SET used=TRUE WHERE code=$1', [inviteCode]);

    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  POST /api/data — ESP32 sensor payload
// ════════════════════════════════════════════════════════════
app.post('/api/data', async (req, res) => {
  const body = req.body;
  if (!body || !body.hud) return res.status(400).json({ error: 'bad payload' });

  const deviceId   = req.headers['x-device-id'];
  const devicePass = req.headers['x-device-password'];

  if (deviceId && devicePass) {
    try {
      const dr = await pool.query('SELECT * FROM devices WHERE device_id=$1', [deviceId]);
      if (!dr.rows.length) return res.status(401).json({ error: 'Unknown device' });
      if (!verifyPassword(devicePass, dr.rows[0].password_hash, dr.rows[0].password_salt))
        return res.status(401).json({ error: 'Invalid device password' });
      pool.query('UPDATE devices SET last_seen=NOW() WHERE device_id=$1', [deviceId]).catch(() => {});
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  latestData = body;
  const h = body.hud;
  const t = body.thermal;

  pool.query(
    `INSERT INTO hud_readings (temp,hum,dist,risk,status,tof_ok) VALUES ($1,$2,$3,$4,$5,$6)`,
    [h.temp, h.hum, h.tofOK ? h.dist : null, h.risk, h.status, h.tofOK]
  ).catch(e => console.error('HUD insert:', e.message));

  if (t && t.linked) {
    pool.query(
      `INSERT INTO thermal_readings (min_temp,max_temp,cross_temp,status,human,fire) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.minTemp, t.maxTemp, t.crossTemp, t.status, t.humanDetected, t.fireDetected]
    ).catch(e => console.error('Thermal insert:', e.message));

    if (t.fireDetected) {
      pool.query(
        `INSERT INTO alert_logs (alert_type,device_id,temp,hum,risk,min_temp,max_temp,cross_temp,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['FIRE', deviceId||'unknown', h.temp, h.hum, h.risk, t.minTemp, t.maxTemp, t.crossTemp, 'Fire detected by thermal sensor']
      ).catch(e => console.error('Alert log:', e.message));
    } else if (t.humanDetected) {
      pool.query(
        `INSERT INTO alert_logs (alert_type,device_id,temp,hum,risk,min_temp,max_temp,cross_temp,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['HUMAN', deviceId||'unknown', h.temp, h.hum, h.risk, t.minTemp, t.maxTemp, t.crossTemp, 'Possible survivor detected']
      ).catch(e => console.error('Alert log:', e.message));
    }
  }

  if (h.risk >= 65) {
    pool.query(
      `INSERT INTO alert_logs (alert_type,device_id,temp,hum,risk,details) VALUES ($1,$2,$3,$4,$5,$6)`,
      ['HIGH_RISK', deviceId||'unknown', h.temp, h.hum, h.risk, `High risk: ${h.risk} — ${h.status}`]
    ).catch(e => console.error('Alert log:', e.message));
  }

  wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(latestData)); });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  GET /api/alerts
// ════════════════════════════════════════════════════════════
app.get('/api/alerts', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const type  = req.query.type;
  try {
    let q = `SELECT * FROM alert_logs`;
    const params = [];
    if (type) { q += ` WHERE alert_type=$1`; params.push(type); }
    q += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  GET /api/history
// ════════════════════════════════════════════════════════════
app.get('/api/history', async (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 60, 500);
  try {
    const hudResult = await pool.query(
      `SELECT to_char(recorded_at,'HH24:MI:SS') AS recorded_at, temp,hum,dist,risk FROM hud_readings ORDER BY id DESC LIMIT $1`, [n]);
    const thermalResult = await pool.query(
      `SELECT to_char(recorded_at,'HH24:MI:SS') AS recorded_at, min_temp,max_temp,cross_temp FROM thermal_readings ORDER BY id DESC LIMIT $1`, [n]);
    res.json({ hud: hudResult.rows.reverse(), thermal: thermalResult.rows.reverse() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  EXPORT ROUTES (require auth)
// ════════════════════════════════════════════════════════════
app.get('/api/export/excel', requireAuth, async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const hudRows     = (await pool.query(`SELECT * FROM hud_readings ORDER BY id`)).rows;
    const thermalRows = (await pool.query(`SELECT * FROM thermal_readings ORDER BY id`)).rows;
    const alertRows   = (await pool.query(`SELECT * FROM alert_logs ORDER BY id DESC`)).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Luminexus'; wb.created = new Date();

    const hudSheet = wb.addWorksheet('HUD Readings');
    hudSheet.columns = [
      { header:'Timestamp',    key:'recorded_at', width:22 },
      { header:'Temp (°C)',    key:'temp',        width:12 },
      { header:'Humidity (%)', key:'hum',         width:14 },
      { header:'Distance (m)', key:'dist',        width:14 },
      { header:'Risk Score',   key:'risk',        width:12 },
      { header:'Status',       key:'status',      width:20 },
      { header:'TOF OK',       key:'tof_ok',      width:10 },
    ];
    hudSheet.getRow(1).eachCell(cell => {
      cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0D1B2A'}};
      cell.alignment={horizontal:'center'};
    });
    hudRows.forEach(row => {
      const r=hudSheet.addRow({...row,tof_ok:row.tof_ok?'YES':'NO'});
      const rc=r.getCell('risk');
      if(row.risk>=65){rc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFF2244'}};rc.font={color:{argb:'FFFFFFFF'},bold:true};}
      else if(row.risk>=30){rc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE040'}};rc.font={color:{argb:'FF000000'},bold:true};}
      else{rc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF00AA55'}};rc.font={color:{argb:'FFFFFFFF'},bold:true};}
    });

    const thSheet = wb.addWorksheet('Thermal Readings');
    thSheet.columns = [
      { header:'Timestamp',      key:'recorded_at', width:22 },
      { header:'Min Temp (°C)',  key:'min_temp',    width:14 },
      { header:'Max Temp (°C)',  key:'max_temp',    width:14 },
      { header:'Crosshair (°C)', key:'cross_temp',  width:16 },
      { header:'Status',         key:'status',      width:22 },
      { header:'Human Detected', key:'human',       width:16 },
      { header:'Fire Detected',  key:'fire',        width:14 },
    ];
    thSheet.getRow(1).eachCell(cell => {
      cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1A0A00'}};
      cell.alignment={horizontal:'center'};
    });
    thermalRows.forEach(row => {
      const r=thSheet.addRow({...row,human:row.human?'YES':'NO',fire:row.fire?'YES':'NO'});
      if(row.fire){r.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF3A0010'}};c.font={color:{argb:'FFFF2244'}};});}
      else if(row.human){r.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1A1A05'}};c.font={color:{argb:'FFFFE040'}};});}
    });

    const alSheet = wb.addWorksheet('Alert Logs');
    alSheet.columns = [
      { header:'Timestamp',  key:'recorded_at', width:22 },
      { header:'Alert Type', key:'alert_type',  width:14 },
      { header:'Device ID',  key:'device_id',   width:14 },
      { header:'Temp (°C)',  key:'temp',        width:12 },
      { header:'Humidity',   key:'hum',         width:10 },
      { header:'Risk',       key:'risk',        width:10 },
      { header:'Max Temp',   key:'max_temp',    width:12 },
      { header:'Details',    key:'details',     width:40 },
    ];
    alSheet.getRow(1).eachCell(cell => {
      cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1A0005'}};
      cell.alignment={horizontal:'center'};
    });
    alertRows.forEach(row => {
      const r=alSheet.addRow(row);
      const tc=r.getCell('alert_type');
      if(row.alert_type==='FIRE'){tc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFF2244'}};tc.font={color:{argb:'FFFFFFFF'},bold:true};}
      else if(row.alert_type==='HUMAN'){tc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE040'}};tc.font={color:{argb:'FF000000'},bold:true};}
      else{tc.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFF6B00'}};tc.font={color:{argb:'FFFFFFFF'},bold:true};}
    });

    const sum = wb.addWorksheet('Summary');
    sum.getColumn('A').width=28; sum.getColumn('B').width=18;
    sum.addRow(['LUMINEXUS EXPORT SUMMARY']).getCell(1).font={bold:true,size:14,color:{argb:'FF00F5FF'}};
    sum.addRow([`Generated: ${new Date().toLocaleString()}`]);
    sum.addRow([`HUD Readings: ${hudRows.length}`]);
    sum.addRow([`Thermal Readings: ${thermalRows.length}`]);
    sum.addRow([`Total Alerts: ${alertRows.length}`]);
    sum.addRow([`Fire Alerts: ${alertRows.filter(r=>r.alert_type==='FIRE').length}`]);
    sum.addRow([`Human Detections: ${alertRows.filter(r=>r.alert_type==='HUMAN').length}`]);
    sum.addRow([`High Risk Events: ${alertRows.filter(r=>r.alert_type==='HIGH_RISK').length}`]);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="luminexus_${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('Excel export error:', e);
    res.status(500).json({ error: e.message || e.toString() });
  }
});

app.get('/api/export/csv', requireAuth, async (req, res) => {
  try {
    const rows = (await pool.query(`SELECT * FROM hud_readings ORDER BY id`)).rows;
    const header = 'id,recorded_at,temp,hum,dist,risk,status,tof_ok\n';
    const body   = rows.map(r =>
      `${r.id},"${r.recorded_at}",${r.temp},${r.hum},${r.dist??''},${r.risk},"${r.status}",${r.tof_ok}`
    ).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="luminexus_${Date.now()}.csv"`);
    res.send(header + body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  STATIC + SERVER
// ════════════════════════════════════════════════════════════
app.get('/api/data', (req, res) => res.json(latestData));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.use(express.static('public'));

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
wss.on('connection', ws => { ws.send(JSON.stringify(latestData)); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Luminexus running on port ${PORT}`));