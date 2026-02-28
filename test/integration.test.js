const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { createRouter } = require('../src/server-handler');
const webxios = require('../src/index');

/**
 * Start a WS server with a simple router on a random port.
 * Returns { url, close }.
 */
function startServer() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;

      const router = createRouter();

      router.get('/ping', () => ({ pong: true }));

      router.get('/users', (req) => {
        const page = req.query.page || '1';
        return { page: +page, users: ['Ada', 'Bob'] };
      });

      router.get('/users/:id', (req) => {
        if (req.params.id === '999') {
          const e = new Error('Not found');
          e.status = 404;
          throw e;
        }
        return { id: req.params.id, name: 'Ada' };
      });

      router.post('/users', (req) => ({ created: true, body: req.body }));
      router.put('/users/:id', (req) => ({ updated: true, id: req.params.id, body: req.body }));
      router.patch('/users/:id', (req) => ({ patched: true, id: req.params.id, body: req.body }));
      router.delete('/users/:id', (req) => ({ deleted: true, id: req.params.id }));
      router.head('/health', () => ({}));

      router.get('/echo-headers', (req) => ({ headers: req.headers }));

      wss.on('connection', (ws) => router.attach(ws));

      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () => new Promise((r) => wss.close(r)),
      });
    });
  });
}

describe('webxios client + server integration', () => {
  let server;
  let api;

  // Use a fresh server for the whole suite
  it('setup', async () => {
    server = await startServer();
    api = webxios.create(server.url, { timeout: 5000, reconnect: false });
    await api.connect();
  });

  after(async () => {
    api?.close();
    await server?.close();
  });

  it('GET simple route', async () => {
    const res = await api.get('/ping');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { pong: true });
  });

  it('GET with query string', async () => {
    const res = await api.get('/users?page=3');
    assert.equal(res.status, 200);
    assert.equal(res.data.page, 3);
    assert.deepEqual(res.data.users, ['Ada', 'Bob']);
  });

  it('GET with :param', async () => {
    const res = await api.get('/users/7');
    assert.equal(res.status, 200);
    assert.equal(res.data.id, '7');
  });

  it('POST with JSON body', async () => {
    const res = await api.post('/users', { name: 'Charlie' });
    assert.equal(res.status, 200);
    assert.equal(res.data.created, true);
    assert.deepEqual(res.data.body, { name: 'Charlie' });
  });

  it('PUT with body', async () => {
    const res = await api.put('/users/1', { name: 'Updated' });
    assert.equal(res.status, 200);
    assert.equal(res.data.updated, true);
    assert.equal(res.data.id, '1');
  });

  it('PATCH with body', async () => {
    const res = await api.patch('/users/2', { name: 'Patched' });
    assert.equal(res.status, 200);
    assert.equal(res.data.patched, true);
  });

  it('DELETE', async () => {
    const res = await api.delete('/users/5');
    assert.equal(res.status, 200);
    assert.equal(res.data.deleted, true);
    assert.equal(res.data.id, '5');
  });

  it('HEAD', async () => {
    const res = await api.head('/health');
    assert.equal(res.status, 200);
  });

  it('request() generic method', async () => {
    const res = await api.request({ method: 'GET', url: '/ping' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { pong: true });
  });

  it('sends custom headers', async () => {
    const res = await api.get('/echo-headers', { headers: { 'x-custom': 'yes' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.headers['x-custom'], 'yes');
  });

  it('receives 404 as rejected error', async () => {
    await assert.rejects(() => api.get('/users/999'), (err) => {
      assert.equal(err.response.status, 404);
      assert.equal(err.response.data.error, 'Not found');
      return true;
    });
  });

  it('receives 404 for unknown route', async () => {
    await assert.rejects(() => api.get('/nonexistent'), (err) => {
      assert.equal(err.response.status, 404);
      return true;
    });
  });

  it('response includes config', async () => {
    const res = await api.post('/users', { x: 1 });
    assert.equal(res.config.method, 'POST');
    assert.equal(res.config.url, '/users');
  });
});

describe('webxios timeout', () => {
  it('rejects after timeout when server never replies', async () => {
    // Start a WS server that accepts connections but never replies
    const wss = new WebSocketServer({ port: 0 });
    const port = await new Promise((r) => wss.on('listening', () => r(wss.address().port)));

    wss.on('connection', () => { /* intentionally no reply */ });

    const api = webxios.create(`ws://127.0.0.1:${port}`, { timeout: 200, reconnect: false });
    await api.connect();

    await assert.rejects(() => api.get('/slow'), (err) => {
      assert.match(err.message, /timeout/);
      return true;
    });

    api.close();
    await new Promise((r) => wss.close(r));
  });
});

describe('webxios close', () => {
  it('rejects pending requests when socket closes', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = await new Promise((r) => wss.on('listening', () => r(wss.address().port)));

    // Close the client socket immediately on receiving a message
    wss.on('connection', (ws) => {
      ws.on('message', () => ws.close());
    });

    const api = webxios.create(`ws://127.0.0.1:${port}`, { timeout: 5000, reconnect: false });
    await api.connect();

    await assert.rejects(() => api.get('/anything'), (err) => {
      assert.match(err.message, /closed/i);
      return true;
    });

    api.close();
    await new Promise((r) => wss.close(r));
  });
});
