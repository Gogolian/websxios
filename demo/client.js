/**
 * Demo client – run with:  node demo/client.js
 * (start the server first: node demo/server.js)
 *
 * Shows how you'd swap axios calls for webxios calls.
 */
const webxios = require('../src/index');

async function main() {
  // ---- before (axios) ----
  // const axios = require('axios');
  // const base  = 'http://localhost:4000';
  // const res   = await axios.get(`${base}/users?page=1`);

  // ---- after (webxios) — only the import + create line changes ----
  const api = webxios.create('ws://localhost:4000/ws');
  await api.connect();

  console.log('\n--- GET /users?page=1 ---');
  const list = await api.get('/users?page=1');
  console.log(list.status, list.data);

  console.log('\n--- POST /users ---');
  const created = await api.post('/users', { name: 'Alan Turing' });
  console.log(created.status, created.data);

  console.log('\n--- GET /users/3 ---');
  const single = await api.get('/users/3');
  console.log(single.status, single.data);

  console.log('\n--- PUT /users/3 ---');
  const updated = await api.put('/users/3', { name: 'Alan M. Turing' });
  console.log(updated.status, updated.data);

  console.log('\n--- DELETE /users/3 ---');
  const deleted = await api.delete('/users/3');
  console.log(deleted.status, deleted.data);

  console.log('\n--- GET /nonexistent (404) ---');
  try {
    await api.get('/nonexistent');
  } catch (err) {
    console.log(err.response.status, err.response.data);
  }

  api.close();
  console.log('\ndone.');
}

main().catch(console.error);
