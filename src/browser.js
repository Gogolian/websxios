/**
 * webxios – browser build
 *
 * Uses the native WebSocket API (no dependencies).
 * Drop this in a <script> tag or import as an ES module.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.webxios = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  let _idCounter = 0;
  function nextId() {
    return 'wx_' + (++_idCounter) + '_' + Date.now();
  }

  function create(wsUrl, opts) {
    opts = opts || {};
    var timeout           = opts.timeout           || 30000;
    var reconnect         = opts.reconnect !== undefined ? opts.reconnect : true;
    var reconnectInterval = opts.reconnectInterval || 1000;
    var maxReconnects     = opts.maxReconnects     || 10;
    var defaultHeaders    = opts.headers           || {};

    var ws = null;
    var connected = false;
    var reconnectAttempts = 0;
    var explicitlyClosed = false;
    var pending = {};          // id → { resolve, reject, timer, config }
    var onOpenQueue = [];      // promises waiting for connection

    // --- lifecycle ---------------------------------------------------

    function connect() {
      return new Promise(function (resolve, reject) {
        if (connected && ws && ws.readyState === WebSocket.OPEN) {
          return resolve();
        }

        ws = new WebSocket(wsUrl);

        ws.onopen = function () {
          connected = true;
          reconnectAttempts = 0;
          // flush anything waiting
          onOpenQueue.forEach(function (cb) { cb(); });
          onOpenQueue = [];
          resolve();
        };

        ws.onmessage = function (event) {
          var msg;
          try { msg = JSON.parse(event.data); } catch (e) { return; }
          var entry = pending[msg.id];
          if (!entry) return;
          clearTimeout(entry.timer);
          delete pending[msg.id];

          var response = {
            status:  msg.s || 200,
            data:    msg.d,
            headers: msg.h || {},
            config:  entry.config,
          };

          if (msg.s >= 400) {
            var err = new Error('Request failed with status ' + msg.s);
            err.response = response;
            entry.reject(err);
          } else {
            entry.resolve(response);
          }
        };

        ws.onclose = function () {
          connected = false;
          Object.keys(pending).forEach(function (id) {
            clearTimeout(pending[id].timer);
            pending[id].reject(new Error('WebSocket closed'));
          });
          pending = {};

          if (!explicitlyClosed && reconnect && reconnectAttempts < maxReconnects) {
            reconnectAttempts++;
            setTimeout(function () { connect().catch(function () {}); }, reconnectInterval);
          }
        };

        ws.onerror = function (err) {
          if (!connected) reject(err);
        };
      });
    }

    function close() {
      explicitlyClosed = true;
      if (ws) ws.close();
    }

    // --- request plumbing --------------------------------------------

    function request(method, url, body, extraHeaders) {
      var ready = (connected && ws && ws.readyState === WebSocket.OPEN)
        ? Promise.resolve()
        : connect();

      return ready.then(function () {
        var id = nextId();
        var h = {};
        var k;
        for (k in defaultHeaders) h[k] = defaultHeaders[k];
        if (extraHeaders) { for (k in extraHeaders) h[k] = extraHeaders[k]; }

        var msg = { id: id, m: method, u: url };
        if (body !== undefined && body !== null) {
          msg.b = typeof body === 'string' ? body : JSON.stringify(body);
        }
        if (Object.keys(h).length) msg.h = h;

        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            delete pending[id];
            reject(new Error('webxios: timeout after ' + timeout + 'ms – ' + method + ' ' + url));
          }, timeout);

          pending[id] = {
            resolve: resolve,
            reject: reject,
            timer: timer,
            config: { method: method, url: url, data: body, headers: h },
          };

          ws.send(JSON.stringify(msg));
        });
      });
    }

    // --- public API --------------------------------------------------

    return {
      request: function (config) {
        return request(
          (config.method || 'GET').toUpperCase(),
          config.url,
          config.data,
          config.headers
        );
      },
      get:    function (url, cfg) { cfg = cfg || {}; return request('GET',    url, null, cfg.headers); },
      delete: function (url, cfg) { cfg = cfg || {}; return request('DELETE', url, null, cfg.headers); },
      head:   function (url, cfg) { cfg = cfg || {}; return request('HEAD',   url, null, cfg.headers); },
      post:   function (url, data, cfg) { cfg = cfg || {}; return request('POST',  url, data, cfg.headers); },
      put:    function (url, data, cfg) { cfg = cfg || {}; return request('PUT',   url, data, cfg.headers); },
      patch:  function (url, data, cfg) { cfg = cfg || {}; return request('PATCH', url, data, cfg.headers); },
      connect: connect,
      close: close,
      get ws() { return ws; },
    };
  }

  return { create: create };
});
