# webxios

> Tired of slow, one-way REST calls?  
> WebSocket is sexy but you already have a codebase full of REST methods?

**webxios** is a drop-in replacement for [axios](https://github.com/axios/axios) that sends every HTTP-style request through a single WebSocket connection.

[![npm version](https://img.shields.io/npm/v/webxios.svg)](https://www.npmjs.com/package/webxios)
[![license](https://img.shields.io/npm/l/webxios.svg)](./LICENSE)

## Why?

You have a codebase full of `axios.get(...)`, `axios.post(...)` calls.
You want to move to WebSocket but rewriting everything is painful.
With **webxios** you just swap the import:

```diff
- import axios from 'axios';
- const api = axios.create({ baseURL: 'http://localhost:4000' });
+ import webxios from 'webxios';
+ const api = webxios.create('ws://localhost:4000');
+ await api.connect();

  const res = await api.get('/users?page=1');    // ← identical API
  const res = await api.post('/users', { name: 'Ada' });
```

Everything else stays the same — same `.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`, same `res.status`, `res.data`, same `try/catch` with `err.response`.

## Install

```bash
npm install webxios
```

## Quick Start

### Node.js

```js
const webxios = require('webxios');

const api = webxios.create('ws://localhost:4000');
await api.connect();

const { data } = await api.get('/users?page=1');
console.log(data);

api.close();
```

### Browser

```html
<script src="node_modules/webxios/browser.js"></script>
<script>
  const api = webxios.create('ws://yourserver.com/ws');
  api.connect().then(async () => {
    const res = await api.get('/users');
    console.log(res.data);
  });
</script>
```

Or with a bundler (webpack, vite, etc.):

```js
import webxios from 'webxios/browser';

const api = webxios.create('ws://localhost:4000');
await api.connect();
```

## API

### `webxios.create(wsUrl, options?)`

Returns an instance with these methods (mirrors axios):

| Method | Signature |
|--------|-----------|
| `get`    | `(url, config?) → Promise<Response>` |
| `delete` | `(url, config?) → Promise<Response>` |
| `head`   | `(url, config?) → Promise<Response>` |
| `post`   | `(url, data?, config?) → Promise<Response>` |
| `put`    | `(url, data?, config?) → Promise<Response>` |
| `patch`  | `(url, data?, config?) → Promise<Response>` |
| `request`| `(config) → Promise<Response>` |

**Response** object:

```js
{
  status:  200,          // numeric status code
  data:    { ... },      // parsed response body
  headers: { ... },      // response headers
  config:  { ... },      // original request config
}
```

Errors for status >= 400 are thrown with `err.response` attached (just like axios).

### Options

```js
webxios.create('ws://localhost:4000', {
  timeout:           30000,   // per-request timeout in ms
  reconnect:         true,    // auto-reconnect on drop
  reconnectInterval: 1000,    // ms between retries
  maxReconnects:     10,
  headers:           {},      // default headers sent with every request
});
```

### Instance methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to the WebSocket server. Returns a `Promise`. |
| `close()`   | Gracefully close the connection. |
| `ws`         | The underlying `WebSocket` object (getter). |

## Wire Protocol

Every call becomes a compact JSON message over the WebSocket:

```
→  { id, m, u, b, h }       request
←  { id, s, d, h }          response
```

| Field | Direction | Meaning |
|-------|-----------|---------|
| `id`  | both      | Correlation ID to match req ↔ res |
| `m`   | →         | HTTP method (`GET`, `POST`, …) |
| `u`   | →         | Path + query string (`/users?page=1`) |
| `b`   | →         | Serialized body (string) |
| `h`   | both      | Headers object |
| `s`   | ←         | Status code (200, 404, …) |
| `d`   | ←         | Response data |

## Server-Side Helper

The package includes an optional Express-style router for your WebSocket server:

```js
const { WebSocketServer } = require('ws');
const { createRouter } = require('webxios/server');

const router = createRouter();

router.get('/users',      (req) => db.getUsers(req.query));
router.post('/users',     (req) => db.createUser(req.body));
router.get('/users/:id',  (req) => db.getUser(req.params.id));

const wss = new WebSocketServer({ port: 4000 });
wss.on('connection', (ws) => router.attach(ws));
```

Route handlers receive a request-like object:

```js
{
  method:  'POST',
  url:     '/users?sort=name',
  path:    '/users',
  query:   { sort: 'name' },
  params:  { id: '42' },       // from :param patterns
  headers: { ... },
  body:    { ... },             // parsed JSON body
}
```

Return a value (or a Promise) and it becomes the response `d` field with status `200`.  
Throw an error with `.status` or `.statusCode` to send an error response.

## Demo

The repo includes a full working demo with a Node.js server and a vanilla-JS frontend:

```bash
git clone https://github.com/user/webxios.git
cd webxios
npm install
node demo/server.js
# open http://localhost:4000 in your browser
```

## License

MIT
