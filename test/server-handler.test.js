const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../src/server-handler');

/**
 * Helper: simulate a WebSocket that records sent messages.
 */
function mockWs() {
  const listeners = {};
  const sent = [];
  return {
    on(event, fn) { listeners[event] = fn; },
    send(data) { sent.push(JSON.parse(data)); },
    sent,
    /** Simulate an incoming message */
    receive(msg) { listeners.message(JSON.stringify(msg)); },
  };
}

describe('createRouter', () => {
  it('registers and matches GET route', async () => {
    const router = createRouter();
    router.get('/hello', () => ({ msg: 'hi' }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '1', m: 'GET', u: '/hello' });

    // handler is async internally, wait a tick
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0].id, '1');
    assert.equal(ws.sent[0].s, 200);
    assert.deepEqual(ws.sent[0].d, { msg: 'hi' });
  });

  it('returns 404 for unregistered route', async () => {
    const router = createRouter();
    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '2', m: 'GET', u: '/nope' });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ws.sent[0].s, 404);
    assert.deepEqual(ws.sent[0].d, { error: 'Not found' });
  });

  it('matches route with :param segments', async () => {
    const router = createRouter();
    router.get('/users/:id', (req) => ({ userId: req.params.id }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '3', m: 'GET', u: '/users/42' });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ws.sent[0].d, { userId: '42' });
  });

  it('parses query string', async () => {
    const router = createRouter();
    router.get('/search', (req) => ({ q: req.query.q, page: req.query.page }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '4', m: 'GET', u: '/search?q=hello&page=2' });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ws.sent[0].d, { q: 'hello', page: '2' });
  });

  it('parses JSON body on POST', async () => {
    const router = createRouter();
    router.post('/items', (req) => ({ received: req.body }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '5', m: 'POST', u: '/items', b: '{"name":"test"}' });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ws.sent[0].d, { received: { name: 'test' } });
  });

  it('passes non-JSON body as string', async () => {
    const router = createRouter();
    router.post('/raw', (req) => ({ received: req.body }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '6', m: 'POST', u: '/raw', b: 'plain text' });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ws.sent[0].d, { received: 'plain text' });
  });

  it('forwards headers from the message', async () => {
    const router = createRouter();
    router.get('/auth', (req) => ({ token: req.headers.authorization }));

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '7', m: 'GET', u: '/auth', h: { authorization: 'Bearer xyz' } });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ws.sent[0].d, { token: 'Bearer xyz' });
  });

  it('returns error status when handler throws', async () => {
    const router = createRouter();
    router.get('/fail', () => {
      const err = new Error('gone');
      err.status = 410;
      throw err;
    });

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '8', m: 'GET', u: '/fail' });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ws.sent[0].s, 410);
    assert.deepEqual(ws.sent[0].d, { error: 'gone' });
  });

  it('defaults to 500 when handler throws without status', async () => {
    const router = createRouter();
    router.get('/err', () => { throw new Error('oops'); });

    const ws = mockWs();
    router.attach(ws);
    ws.receive({ id: '9', m: 'GET', u: '/err' });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ws.sent[0].s, 500);
    assert.deepEqual(ws.sent[0].d, { error: 'oops' });
  });

  it('supports all HTTP method helpers', async () => {
    const router = createRouter();
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head'];
    methods.forEach((m) => {
      router[m]('/m', (req) => ({ method: req.method }));
    });

    const ws = mockWs();
    router.attach(ws);

    for (let i = 0; i < methods.length; i++) {
      ws.receive({ id: `m${i}`, m: methods[i].toUpperCase(), u: '/m' });
    }

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ws.sent.length, methods.length);
    methods.forEach((m, i) => {
      assert.equal(ws.sent[i].d.method, m.toUpperCase());
    });
  });

  it('ignores invalid JSON messages', async () => {
    const router = createRouter();
    // Use a mock that fails if send() is called
    const listeners = {};
    const ws = {
      on(event, fn) { listeners[event] = fn; },
      send() { assert.fail('should not send'); },
    };
    router.attach(ws);
    listeners.message('not json at all');

    await new Promise((r) => setTimeout(r, 10));
    // No assertions needed – test passes if no error is thrown
  });
});
