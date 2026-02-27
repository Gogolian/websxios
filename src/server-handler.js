/**
 * Server-side helper that turns incoming webxios WS messages into
 * something your existing Express/Koa/Fastify route handlers can consume.
 *
 * Usage with plain ws:
 *
 *   const { WebSocketServer } = require('ws');
 *   const { createRouter } = require('webxios/src/server-handler');
 *
 *   const router = createRouter();
 *   router.get('/users', (req) => ({ users: ['Ada','Bob'] }));
 *   router.post('/users', (req) => ({ created: true, body: req.body }));
 *
 *   const wss = new WebSocketServer({ port: 4000 });
 *   wss.on('connection', (ws) => router.attach(ws));
 */

function createRouter() {
  // routes: Map<'METHOD /path', handler>
  const routes = new Map();

  function addRoute(method, path, handler) {
    routes.set(`${method} ${path}`, handler);
  }

  function findHandler(method, pathname) {
    // Exact match first
    const exact = routes.get(`${method} ${pathname}`);
    if (exact) return { handler: exact, params: {} };

    // Simple :param matching
    for (const [pattern, handler] of routes) {
      const [pMethod, pPath] = pattern.split(' ', 2);
      if (pMethod !== method) continue;

      const patternParts = pPath.split('/');
      const urlParts = pathname.split('/');
      if (patternParts.length !== urlParts.length) continue;

      const params = {};
      let match = true;
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
          params[patternParts[i].slice(1)] = urlParts[i];
        } else if (patternParts[i] !== urlParts[i]) {
          match = false;
          break;
        }
      }
      if (match) return { handler, params };
    }

    return null;
  }

  function attach(ws) {
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      const { id, m: method, u: url, b: body, h: headers } = msg;

      // Parse URL into pathname + query
      const qIdx = url.indexOf('?');
      const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
      const search = qIdx >= 0 ? url.slice(qIdx + 1) : '';
      const query = Object.fromEntries(new URLSearchParams(search));

      const found = findHandler(method, pathname);

      if (!found) {
        ws.send(JSON.stringify({ id, s: 404, d: { error: 'Not found' } }));
        return;
      }

      // Build a request-like object your handlers can use
      const req = {
        method,
        url,
        path: pathname,
        query,
        params: found.params,
        headers: headers ?? {},
        body: tryParse(body),
      };

      try {
        const result = await found.handler(req);
        ws.send(JSON.stringify({ id, s: 200, d: result }));
      } catch (err) {
        const status = err.status || err.statusCode || 500;
        ws.send(JSON.stringify({ id, s: status, d: { error: err.message } }));
      }
    });
  }

  return {
    get:    (path, handler) => addRoute('GET',    path, handler),
    post:   (path, handler) => addRoute('POST',   path, handler),
    put:    (path, handler) => addRoute('PUT',    path, handler),
    patch:  (path, handler) => addRoute('PATCH',  path, handler),
    delete: (path, handler) => addRoute('DELETE', path, handler),
    head:   (path, handler) => addRoute('HEAD',   path, handler),
    attach,
  };
}

function tryParse(str) {
  if (str == null) return undefined;
  try { return JSON.parse(str); } catch { return str; }
}

module.exports = { createRouter };
