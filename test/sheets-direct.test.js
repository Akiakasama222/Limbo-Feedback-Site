'use strict';
// The API tests with a Google Sheet as database, the site adding rows itself (MAKE_WEBHOOK_URL empty).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockGoogle } = require('./mock-google');
const mock = createMockGoogle();

process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.PUBLIC_CACHE_SECONDS = '0';
process.env.SHEET_CACHE_SECONDS = '0';
process.env.GOOGLE_SHEET_ID = 'SHEET123';
delete process.env.VERCEL; delete process.env.MAKE_WEBHOOK_URL;
const { createServer } = require('../dev-server');
const { registerTests } = require('./shared');

let server, google, base;
test.before(async () => {
  google = mock.server;
  await new Promise(r => google.listen(0, r));
  const g = 'http://localhost:' + google.address().port;
  process.env.GOOGLE_TOKEN_URL = g + '/token';
  process.env.GOOGLE_SHEETS_API = g + '/v4';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(mock.account);
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); google.close(); });
registerTests(() => base);

const post = body => fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': '9.9.9.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(body) });

test('sheet: rows have the documented columns; the Google login (signed JWT) works and is reused', async () => {
  const header = mock.state.rows[0];
  assert.deepEqual(header, ['id', 'createdAt', 'date', 'anonymous', 'name', 'title', 'content', 'hidden', 'edited', 'updatedAt', 'rating']);
  const row = mock.state.rows[1];
  assert.match(row[0], /^f[a-f0-9]{11}$/);
  assert.equal(typeof row[1], 'number');
  assert.equal(row[2], new Date(row[1]).toISOString());
  assert.equal(mock.state.tokenRequests, 1, 'one token is reused for all requests');
  assert.ok(mock.state.valueInputOptions.every(o => o === 'RAW'));
});

test('sheet: text that looks like a formula is protected in the sheet and read back unchanged', async () => {
  const evil = '=HYPERLINK("http://evil.example","click")';
  assert.equal((await post({ anonymous: false, name: '+1 Fan', title: '-5 stars', content: evil + ' and more text' })).status, 201);
  const row = mock.state.rows.find(r => r[5] === "'-5 stars");
  assert.ok(row, 'title stored with a protective apostrophe');
  assert.equal(row[4], "'+1 Fan");
  assert.ok(row[6].startsWith("'="));
  const list = await (await fetch(base + '/api/feedback')).json();
  const item = list.items.find(i => i.title === '-5 stars');
  assert.equal(item.name, '+1 Fan');
  assert.equal(item.content, evil + ' and more text');
});

test('sheet: rows the owner edits by hand are understood (TRUE / FALSE text, extra rows ignored)', async () => {
  const before = (await (await fetch(base + '/api/feedback')).json()).total;
  mock.state.rows.push(['fabcdef01234', Date.now(), '', 'TRUE', '', 'Hand written', 'Typed straight into the sheet', 'FALSE', '', '']);
  mock.state.rows.push(['not-an-id', Date.now(), '', true, '', 'Ignored', 'This row has no valid id', false, false, '']);
  mock.state.rows.push([]);                                              // blank row in the middle
  mock.state.rows.push(['fabcdef01235', Date.now(), '', 'FALSE', 'Sam', 'Hidden by me', 'The owner set hidden to TRUE', 'TRUE', '', '']);
  const list = await (await fetch(base + '/api/feedback')).json();
  assert.equal(list.total, before + 1);
  assert.ok(list.items.some(i => i.title === 'Hand written' && i.name === 'Anonymous'));
  assert.ok(!list.items.some(i => i.title === 'Ignored' || i.title === 'Hidden by me'));
});

test('sheet: deleting removes exactly that row', async () => {
  const cookie = (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'x-real-ip': '8.8.8.8' }, body: JSON.stringify({ password: 'test-pass-123' }) })).headers.get('set-cookie').split(';')[0];
  await post({ title: 'To delete', content: 'This one will be removed.' });
  await post({ title: 'To keep', content: 'This one must survive.' });
  const rowsBefore = mock.state.rows.length;
  const all = await (await fetch(base + '/api/admin/feedback', { headers: { 'X-Requested-With': 'fetch', Cookie: cookie } })).json();
  const target = all.items.find(i => i.title === 'To delete');
  const res = await fetch(base + '/api/admin/feedback/' + target.id, { method: 'DELETE', headers: { 'X-Requested-With': 'fetch', Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.equal(mock.state.rows.length, rowsBefore - 1);
  assert.ok(!mock.state.rows.some(r => r[5] === 'To delete'));
  assert.ok(mock.state.rows.some(r => r[5] === 'To keep'));
});

test('sheet: wrong sheet id gives a friendly 503 (details only in the log)', async () => {
  const keep = process.env.GOOGLE_SHEET_ID;
  const store = require('../lib/store');
  // a second store instance pointing at a wrong id
  process.env.GOOGLE_SHEET_ID = 'WRONG';
  const res = await fetch(base + '/api/feedback');
  process.env.GOOGLE_SHEET_ID = keep;
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not reachable/);
});

test('setup check: all green with a good sheet; clear messages for a wrong id and a wrong header row', async () => {
  const X = { 'X-Requested-With': 'fetch' };
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...X, 'x-real-ip': '6.6.6.6' }, body: JSON.stringify({ password: 'test-pass-123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const status = async () => (await (await fetch(base + '/api/admin/status', { headers: { ...X, Cookie: cookie } })).json()).checks;
  let checks = await status();
  assert.ok(checks.every(c => c.ok), JSON.stringify(checks));
  assert.match(checks.find(c => c.name === 'Google Sheet access').message, /Connected\. \d+ entries found/);
  assert.match(checks.find(c => c.name === 'GOOGLE_SERVICE_ACCOUNT_JSON').message, /robot@project\.iam\.gserviceaccount\.com/);

  mock.state.rows[0][3] = 'anon';                                     // wrong header
  checks = await status();
  assert.equal(checks.find(c => c.name === 'Sheet header row (row 1)').ok, false);
  assert.match(checks.find(c => c.name === 'Sheet header row (row 1)').message, /Row 1 must be exactly: id, createdAt/);
  mock.state.rows[0][3] = 'anonymous';

  const keep = process.env.GOOGLE_SHEET_ID;
  process.env.GOOGLE_SHEET_ID = 'WRONG';
  checks = await status();
  process.env.GOOGLE_SHEET_ID = keep;
  const access = checks.find(c => c.name === 'Google Sheet access');
  assert.equal(access.ok, false);
  assert.match(access.message, /HTTP 404.*shared with the service account/);
});
