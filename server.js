const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());

// In-memory store — holds latest readings from both nodes
let latestData = {
  hud: { temp: 0, hum: 0, dist: 0, risk: 0, status: 'WAITING', tofOK: false, ts: 0 },
  thermal: { linked: false, minTemp: 0, maxTemp: 0, crossTemp: 0,
             status: 'NO LINK', humanDetected: false, fireDetected: false, ageMs: 99999 }
};

// ESP32 #2 POSTs to this endpoint every loop cycle
app.post('/api/data', (req, res) => {
  const body = req.body;
  if (!body || !body.hud) return res.status(400).json({ error: 'bad payload' });
  latestData = body;
  // Broadcast to all connected browsers
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(latestData));
  });
  res.json({ ok: true });
});

// Browsers poll this for initial load
app.get('/api/data', (req, res) => res.json(latestData));

// Serve the dashboard HTML
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  // Send current data immediately on connect
  ws.send(JSON.stringify(latestData));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Luminexus server running on port ${PORT}`));