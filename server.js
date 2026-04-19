const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// ════════════════════════════════════════════════════════════
//  DATABASE — PostgreSQL (Railway)
//  Add a Postgres plugin in Railway → DATABASE_URL is injected
// ════════════════════════════════════════════════════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hud_readings (
      id          SERIAL PRIMARY KEY,
      recorded_at TIMESTAMP DEFAULT NOW(),
      temp        REAL,
      hum         REAL,
      dist        REAL,
      risk        INTEGER,
      status      TEXT,
      tof_ok      BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS thermal_readings (
      id          SERIAL PRIMARY KEY,
      recorded_at TIMESTAMP DEFAULT NOW(),
      min_temp    REAL,
      max_temp    REAL,
      cross_temp  REAL,
      status      TEXT,
      human       BOOLEAN,
      fire        BOOLEAN
    );
  `);
  console.log('✅ Database tables ready');
}

// Run DB init and verify connection on startup
initDB().catch(err => console.error('❌ DB init error:', err.message));

pool.query('SELECT NOW()')
  .then(r  => console.log('✅ DB connected:', r.rows[0].now))
  .catch(e => console.error('❌ DB connection failed:', e.message));

// ════════════════════════════════════════════════════════════
//  IN-MEMORY STORE (last known state for new WS clients)
// ════════════════════════════════════════════════════════════
let latestData = {
  hud: {
    temp: 0, hum: 0, dist: 0, risk: 0,
    status: 'WAITING', tofOK: false, ts: 0
  },
  thermal: {
    linked: false, minTemp: 0, maxTemp: 0, crossTemp: 0,
    status: 'NO LINK', humanDetected: false, fireDetected: false, ageMs: 99999
  }
};

// ════════════════════════════════════════════════════════════
//  POST /api/data  — ESP32 sends sensor payload here
// ════════════════════════════════════════════════════════════
app.post('/api/data', async (req, res) => {
  const body = req.body;
  if (!body || !body.hud) return res.status(400).json({ error: 'bad payload' });

  latestData = body;
  const h = body.hud;
  const t = body.thermal;

  // Persist HUD reading
  pool.query(
    `INSERT INTO hud_readings (temp, hum, dist, risk, status, tof_ok)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [h.temp, h.hum, h.tofOK ? h.dist : null, h.risk, h.status, h.tofOK]
  ).catch(e => console.error('HUD insert error:', e.message));

  // Persist thermal reading (only when ESP-NOW link is active)
  if (t && t.linked) {
    pool.query(
      `INSERT INTO thermal_readings (min_temp, max_temp, cross_temp, status, human, fire)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.minTemp, t.maxTemp, t.crossTemp, t.status, t.humanDetected, t.fireDetected]
    ).catch(e => console.error('Thermal insert error:', e.message));
  }

  // Broadcast to all connected WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(latestData));
  });

  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  GET /api/history  — chart history
// ════════════════════════════════════════════════════════════
app.get('/api/history', async (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 60, 500);
  try {
    const hudResult = await pool.query(
      `SELECT to_char(recorded_at, 'HH24:MI:SS') AS recorded_at,
              temp, hum, dist, risk
       FROM hud_readings
       ORDER BY id DESC
       LIMIT $1`,
      [n]
    );
    const thermalResult = await pool.query(
      `SELECT to_char(recorded_at, 'HH24:MI:SS') AS recorded_at,
              min_temp, max_temp, cross_temp
       FROM thermal_readings
       ORDER BY id DESC
       LIMIT $1`,
      [n]
    );
    res.json({
      hud:     hudResult.rows.reverse(),
      thermal: thermalResult.rows.reverse()
    });
  } catch (e) {
    console.error('History query error:', e.message);
    res.status(500).json({ error: e.message || e.toString() });
  }
});

// ════════════════════════════════════════════════════════════
//  GET /api/export/excel  — download full dataset as .xlsx
// ════════════════════════════════════════════════════════════
app.get('/api/export/excel', async (req, res) => {
  try {
    // Quick connection check before doing any work
    await pool.query('SELECT 1');

    const hudRows     = (await pool.query(`SELECT * FROM hud_readings     ORDER BY id`)).rows;
    const thermalRows = (await pool.query(`SELECT * FROM thermal_readings ORDER BY id`)).rows;

    console.log(`Excel export: ${hudRows.length} HUD rows, ${thermalRows.length} thermal rows`);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Luminexus';
    wb.created = new Date();

    // ── Sheet 1: HUD Readings ──────────────────────────────
    const hudSheet = wb.addWorksheet('HUD Readings');
    hudSheet.columns = [
      { header: 'Timestamp',    key: 'recorded_at', width: 22 },
      { header: 'Temp (°C)',    key: 'temp',        width: 12 },
      { header: 'Humidity (%)', key: 'hum',         width: 14 },
      { header: 'Distance (m)', key: 'dist',        width: 14 },
      { header: 'Risk Score',   key: 'risk',        width: 12 },
      { header: 'Status',       key: 'status',      width: 20 },
      { header: 'TOF OK',       key: 'tof_ok',      width: 10 },
    ];

    // Style header row
    hudSheet.getRow(1).eachCell(cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Add data rows with colour-coded risk column
    hudRows.forEach(row => {
      const r  = hudSheet.addRow({ ...row, tof_ok: row.tof_ok ? 'YES' : 'NO' });
      const rc = r.getCell('risk');
      if (row.risk >= 65) {
        rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF2244' } };
        rc.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      } else if (row.risk >= 30) {
        rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE040' } };
        rc.font = { color: { argb: 'FF000000' }, bold: true };
      } else {
        rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AA55' } };
        rc.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      }
    });

    // ── Sheet 2: Thermal Readings ──────────────────────────
    const thSheet = wb.addWorksheet('Thermal Readings');
    thSheet.columns = [
      { header: 'Timestamp',      key: 'recorded_at', width: 22 },
      { header: 'Min Temp (°C)',  key: 'min_temp',    width: 14 },
      { header: 'Max Temp (°C)',  key: 'max_temp',    width: 14 },
      { header: 'Crosshair (°C)', key: 'cross_temp',  width: 16 },
      { header: 'Status',         key: 'status',      width: 22 },
      { header: 'Human Detected', key: 'human',       width: 16 },
      { header: 'Fire Detected',  key: 'fire',        width: 14 },
    ];

    // Style header row
    thSheet.getRow(1).eachCell(cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A0A00' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Add data rows; highlight fire/human events
    thermalRows.forEach(row => {
      const r = thSheet.addRow({
        ...row,
        human: row.human ? 'YES' : 'NO',
        fire:  row.fire  ? 'YES' : 'NO'
      });
      if (row.fire) {
        r.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A0010' } };
          c.font = { color: { argb: 'FFFF2244' } };
        });
      } else if (row.human) {
        r.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A05' } };
          c.font = { color: { argb: 'FFFFE040' } };
        });
      }
    });

    // ── Sheet 3: Summary ───────────────────────────────────
    const sum = wb.addWorksheet('Summary');
    sum.getColumn('A').width = 28;
    sum.getColumn('B').width = 18;

    sum.addRow(['LUMINEXUS EXPORT SUMMARY']).getCell(1).font = { bold: true, size: 14, color: { argb: 'FF00F5FF' } };
    sum.addRow([`Generated: ${new Date().toLocaleString()}`]);
    sum.addRow([`HUD Readings: ${hudRows.length}`]);
    sum.addRow([`Thermal Readings: ${thermalRows.length}`]);

    const h = hudRows.length;
    const t = thermalRows.length;

    if (h > 0) {
      sum.addRow([]);
      sum.addRow(['── HUD ──']).getCell(1).font = { bold: true };
      sum.addRow(['Avg Temp (°C)',    { formula: `AVERAGE('HUD Readings'!B2:B${h + 1})` }]);
      sum.addRow(['Avg Humidity (%)', { formula: `AVERAGE('HUD Readings'!C2:C${h + 1})` }]);
      sum.addRow(['Avg Risk',         { formula: `AVERAGE('HUD Readings'!E2:E${h + 1})` }]);
      sum.addRow(['Max Risk',         { formula: `MAX('HUD Readings'!E2:E${h + 1})` }]);
    }

    if (t > 0) {
      sum.addRow([]);
      sum.addRow(['── THERMAL ──']).getCell(1).font = { bold: true };
      sum.addRow(['Avg Max Temp (°C)',  { formula: `AVERAGE('Thermal Readings'!C2:C${t + 1})` }]);
      sum.addRow(['Peak Max Temp (°C)', { formula: `MAX('Thermal Readings'!C2:C${t + 1})` }]);
      sum.addRow(['Fire Events',        thermalRows.filter(r => r.fire).length]);
      sum.addRow(['Human Detections',   thermalRows.filter(r => r.human).length]);
    }

    // Stream the workbook to the client
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="luminexus_${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (e) {
    console.error('Excel export error:', e);
    res.status(500).json({ error: e.message || e.toString() || 'Unknown export error' });
  }
});

// ════════════════════════════════════════════════════════════
//  GET /api/export/csv  — download HUD data as .csv
// ════════════════════════════════════════════════════════════
app.get('/api/export/csv', async (req, res) => {
  try {
    const rows = (await pool.query(`SELECT * FROM hud_readings ORDER BY id`)).rows;
    console.log(`CSV export: ${rows.length} HUD rows`);

    const header = 'id,recorded_at,temp,hum,dist,risk,status,tof_ok\n';
    const body   = rows.map(r =>
      `${r.id},"${r.recorded_at}",${r.temp},${r.hum},${r.dist ?? ''},${r.risk},"${r.status}",${r.tof_ok}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="luminexus_${Date.now()}.csv"`);
    res.send(header + body);

  } catch (e) {
    console.error('CSV export error:', e);
    res.status(500).json({ error: e.message || e.toString() || 'Unknown export error' });
  }
});

// ════════════════════════════════════════════════════════════
//  STANDARD ROUTES
// ════════════════════════════════════════════════════════════
app.get('/api/data', (req, res) => res.json(latestData));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.use(express.static('public'));

// ════════════════════════════════════════════════════════════
//  HTTP + WEBSOCKET SERVER
// ════════════════════════════════════════════════════════════
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

wss.on('connection', ws => {
  // Send current state immediately on connect
  ws.send(JSON.stringify(latestData));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Luminexus running on port ${PORT}`));
