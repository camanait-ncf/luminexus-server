const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'luminexus.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS hud_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT DEFAULT (datetime('now','localtime')),
    temp        REAL,
    hum         REAL,
    dist        REAL,
    risk        INTEGER,
    status      TEXT,
    tof_ok      INTEGER
  );
  CREATE TABLE IF NOT EXISTS thermal_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT DEFAULT (datetime('now','localtime')),
    min_temp    REAL,
    max_temp    REAL,
    cross_temp  REAL,
    status      TEXT,
    human       INTEGER,
    fire        INTEGER
  );
`);

const insertHud = db.prepare(`
  INSERT INTO hud_readings (temp, hum, dist, risk, status, tof_ok)
  VALUES (@temp, @hum, @dist, @risk, @status, @tof_ok)
`);

const insertThermal = db.prepare(`
  INSERT INTO thermal_readings (min_temp, max_temp, cross_temp, status, human, fire)
  VALUES (@min_temp, @max_temp, @cross_temp, @status, @human, @fire)
`);

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
let latestData = {
  hud: { temp: 0, hum: 0, dist: 0, risk: 0, status: 'WAITING', tofOK: false, ts: 0 },
  thermal: { linked: false, minTemp: 0, maxTemp: 0, crossTemp: 0,
             status: 'NO LINK', humanDetected: false, fireDetected: false, ageMs: 99999 }
};

// ─── ESP32 POST ───────────────────────────────────────────────────────────────
app.post('/api/data', (req, res) => {
  const body = req.body;
  if (!body || !body.hud) return res.status(400).json({ error: 'bad payload' });
  latestData = body;

  // Save to DB
  const h = body.hud;
  insertHud.run({
    temp:   h.temp,
    hum:    h.hum,
    dist:   h.tofOK ? h.dist : null,
    risk:   h.risk,
    status: h.status,
    tof_ok: h.tofOK ? 1 : 0
  });

  const t = body.thermal;
  if (t.linked) {
    insertThermal.run({
      min_temp:   t.minTemp,
      max_temp:   t.maxTemp,
      cross_temp: t.crossTemp,
      status:     t.status,
      human:      t.humanDetected ? 1 : 0,
      fire:       t.fireDetected  ? 1 : 0
    });
  }

  // Broadcast to browsers
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(latestData));
  });

  res.json({ ok: true });
});

// ─── HISTORY (for charts) ─────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 60, 500);
  const hud = db.prepare(
    `SELECT recorded_at, temp, hum, dist, risk FROM hud_readings ORDER BY id DESC LIMIT ?`
  ).all(n).reverse();
  const thermal = db.prepare(
    `SELECT recorded_at, min_temp, max_temp, cross_temp FROM thermal_readings ORDER BY id DESC LIMIT ?`
  ).all(n).reverse();
  res.json({ hud, thermal });
});

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────
app.get('/api/export/excel', async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Luminexus';
    wb.created = new Date();

    // HUD Sheet
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
    hudSheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2A' } };
      cell.alignment = { horizontal: 'center' };
    });
    const hudRows = db.prepare(`SELECT * FROM hud_readings ORDER BY id`).all();
    hudRows.forEach(row => {
      const r = hudSheet.addRow({ ...row, tof_ok: row.tof_ok ? 'YES' : 'NO' });
      const riskCell = r.getCell('risk');
      if (row.risk >= 65)      { riskCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFF2244'} }; riskCell.font = { color:{argb:'FFFFFFFF'}, bold:true }; }
      else if (row.risk >= 30) { riskCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFE040'} }; riskCell.font = { color:{argb:'FF000000'}, bold:true }; }
      else                     { riskCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF00AA55'} }; riskCell.font = { color:{argb:'FFFFFFFF'}, bold:true }; }
    });

    // Thermal Sheet
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
    thSheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A0A00' } };
      cell.alignment = { horizontal: 'center' };
    });
    const thRows = db.prepare(`SELECT * FROM thermal_readings ORDER BY id`).all();
    thRows.forEach(row => {
      const r = thSheet.addRow({ ...row, human: row.human ? 'YES' : 'NO', fire: row.fire ? 'YES' : 'NO' });
      if (row.fire)       { r.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF3A0010'} }; c.font = { color:{argb:'FFFF2244'} }; }); }
      else if (row.human) { r.eachCell(c => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A1A05'} }; c.font = { color:{argb:'FFFFE040'} }; }); }
    });

    // Summary Sheet
    const sum = wb.addWorksheet('Summary');
    sum.getColumn('A').width = 28;
    sum.getColumn('B').width = 18;
    sum.addRow(['LUMINEXUS EXPORT SUMMARY']).getCell(1).font = { bold:true, size:14, color:{argb:'FF00F5FF'} };
    sum.addRow([`Generated: ${new Date().toLocaleString()}`]);
    sum.addRow([`Total HUD Readings: ${hudRows.length}`]);
    sum.addRow([`Total Thermal Readings: ${thRows.length}`]);
    if (hudRows.length > 0) {
      sum.addRow([]);
      sum.addRow(['── HUD ──']).getCell(1).font = { bold:true };
      sum.addRow(['Avg Temp (°C)',    { formula: `AVERAGE('HUD Readings'!B2:B${hudRows.length+1})` }]);
      sum.addRow(['Avg Humidity (%)', { formula: `AVERAGE('HUD Readings'!C2:C${hudRows.length+1})` }]);
      sum.addRow(['Avg Risk',         { formula: `AVERAGE('HUD Readings'!E2:E${hudRows.length+1})` }]);
      sum.addRow(['Max Risk',         { formula: `MAX('HUD Readings'!E2:E${hudRows.length+1})` }]);
    }
    if (thRows.length > 0) {
      sum.addRow([]);
      sum.addRow(['── THERMAL ──']).getCell(1).font = { bold:true };
      sum.addRow(['Avg Max Temp (°C)', { formula: `AVERAGE('Thermal Readings'!C2:C${thRows.length+1})` }]);
      sum.addRow(['Peak Max Temp (°C)',{ formula: `MAX('Thermal Readings'!C2:C${thRows.length+1})` }]);
      sum.addRow(['Fire Events',        thRows.filter(r => r.fire).length]);
      sum.addRow(['Human Detections',   thRows.filter(r => r.human).length]);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="luminexus_${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('Excel error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const rows = db.prepare(`SELECT * FROM hud_readings ORDER BY id`).all();
  const header = 'id,recorded_at,temp,hum,dist,risk,status,tof_ok\n';
  const body = rows.map(r =>
    `${r.id},"${r.recorded_at}",${r.temp},${r.hum},${r.dist ?? ''},${r.risk},"${r.status}",${r.tof_ok}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="luminexus_${Date.now()}.csv"`);
  res.send(header + body);
});

// ─── STANDARD ROUTES ──────────────────────────────────────────────────────────
app.get('/api/data', (req, res) => res.json(latestData));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.send(JSON.stringify(latestData));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Luminexus server running on port ${PORT}`));
