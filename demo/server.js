/**
 * Demo server – run with:  node demo/server.js
 *
 * Serves a vanilla-JS frontend on http://localhost:4000
 * and exposes REST-style routes over WebSocket (ws://localhost:4000/ws).
 */
const http              = require('http');
const fs                = require('fs');
const path              = require('path');
const { WebSocketServer } = require('ws');
const { createRouter }    = require('../src/server-handler');

const PORT = 4000;

// ---- static file serving -------------------------------------------

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const httpServer = http.createServer((req, res) => {
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (req.url === '/webxios.js') {
    filePath = path.join(__dirname, '..', 'src', 'browser.js');
  } else {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- define routes exactly like you would in Express ----------------

const router = createRouter();

const users = [
  { id: 1, name: 'Ada Lovelace' },
  { id: 2, name: 'Grace Hopper' },
];

router.get('/users', (req) => {
  const { page = 1, limit = 10 } = req.query;
  return { page: +page, limit: +limit, users };
});

router.get('/users/:id', (req) => {
  const user = users.find(u => u.id === +req.params.id);
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  return user;
});

router.post('/users', (req) => {
  const newUser = { id: users.length + 1, ...req.body };
  users.push(newUser);
  return { created: true, user: newUser };
});

router.put('/users/:id', (req) => {
  const user = users.find(u => u.id === +req.params.id);
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  Object.assign(user, req.body);
  return { updated: true, user };
});

router.delete('/users/:id', (req) => {
  const idx = users.findIndex(u => u.id === +req.params.id);
  if (idx === -1) { const e = new Error('User not found'); e.status = 404; throw e; }
  const [removed] = users.splice(idx, 1);
  return { deleted: true, user: removed };
});

// ---- start server ---------------------------------------------------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log(`[ws] client connected from ${req.socket.remoteAddress}`);
  router.attach(ws);
  ws.on('close', () => console.log('[ws] client disconnected'));
});

httpServer.listen(PORT, () => {
  console.log(`webxios demo server listening on http://localhost:${PORT}`);
  console.log(`  WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
