const { WebSocket } = require('ws');

let _idCounter = 0;
function nextId() {
  return `wx_${++_idCounter}_${Date.now()}`;
}

/**
 * Create a webxios instance bound to a WebSocket URL.
 *
 * Usage:
 *   const api = webxios.create('ws://localhost:4000');
 *   const res = await api.get('/users?page=2');
 *   const res = await api.post('/users', { name: 'Ada' });
 *
 * Wire format  → { id, m, u, b, h }
 * Wire format  ← { id, s, d, h }
 */
function create(wsUrl, opts = {}) {
  const {
    timeout = 30_000,        // per-request timeout (ms)
    reconnect = true,        // auto-reconnect on drop
    reconnectInterval = 1000,
    maxReconnects = 10,
    headers: defaultHeaders = {},
    serialize = JSON.stringify,
    deserialize = JSON.parse,
  } = opts;

  let ws = null;
  let connected = false;
  let reconnectAttempts = 0;
  let explicitlyClosed = false;

  // Pending requests: id → { resolve, reject, timer }
  const pending = new Map();

  // --- WebSocket lifecycle -------------------------------------------

  function connect() {
    return new Promise((resolve, reject) => {
      if (connected && ws?.readyState === WebSocket.OPEN) {
        return resolve();
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connected = true;
        reconnectAttempts = 0;
        resolve();
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = deserialize(event.data); } catch { return; }
        const entry = pending.get(msg.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(msg.id);

        // Build an axios-style response
        const response = {
          status: msg.s ?? 200,
          data: msg.d,
          headers: msg.h ?? {},
          config: entry.config,
        };

        if (msg.s >= 400) {
          const err = new Error(`Request failed with status ${msg.s}`);
          err.response = response;
          entry.reject(err);
        } else {
          entry.resolve(response);
        }
      };

      ws.onclose = () => {
        connected = false;
        // Reject everything still in-flight
        for (const [id, entry] of pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('WebSocket closed'));
        }
        pending.clear();

        if (!explicitlyClosed && reconnect && reconnectAttempts < maxReconnects) {
          reconnectAttempts++;
          setTimeout(() => connect().catch(() => {}), reconnectInterval);
        }
      };

      ws.onerror = (err) => {
        if (!connected) reject(err);
      };
    });
  }

  function close() {
    explicitlyClosed = true;
    ws?.close();
  }

  // --- Request plumbing ----------------------------------------------

  async function request(method, url, body, extraHeaders) {
    // Ensure connection is up
    if (!connected || ws?.readyState !== WebSocket.OPEN) {
      await connect();
    }

    const id = nextId();
    const h = { ...defaultHeaders, ...extraHeaders };

    // Build the compact wire message
    const msg = { id, m: method, u: url };
    if (body !== undefined && body !== null) {
      msg.b = typeof body === 'string' ? body : JSON.stringify(body);
    }
    if (Object.keys(h).length) {
      msg.h = h;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`webxios: timeout after ${timeout}ms – ${method} ${url}`));
      }, timeout);

      pending.set(id, { resolve, reject, timer, config: { method, url, data: body, headers: h } });

      ws.send(serialize(msg));
    });
  }

  // --- Public axios-like API -----------------------------------------

  const instance = {
    /** Raw request – instance.request({ method, url, data, headers }) */
    request(config) {
      return request(
        (config.method || 'GET').toUpperCase(),
        config.url,
        config.data,
        config.headers,
      );
    },

    get(url, config = {})     { return request('GET',    url, null,         config.headers); },
    delete(url, config = {})  { return request('DELETE', url, null,         config.headers); },
    head(url, config = {})    { return request('HEAD',   url, null,         config.headers); },

    post(url, data, config = {})  { return request('POST',  url, data, config.headers); },
    put(url, data, config = {})   { return request('PUT',   url, data, config.headers); },
    patch(url, data, config = {}) { return request('PATCH', url, data, config.headers); },

    /** Expose lifecycle helpers */
    connect,
    close,

    /** Access the raw WebSocket (e.g. for event listeners) */
    get ws() { return ws; },
  };

  return instance;
}

// Convenience: default instance you can configure later
module.exports = { create };
