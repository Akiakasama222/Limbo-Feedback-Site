'use strict';
// What happens on Vercel when the Google Sheet settings are missing or wrong: visitors get a calm generic message,
// the admin can still log in and gets a "setup check" that says exactly what to fix.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.VERCEL = '1';
process.env.ADMIN_PASSWORD = 'test-pass-123';
for (const name of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'MAKE_WEBHOOK_URL']) delete process.env[name];
const { createServer } = require('../dev-server');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, r)); base = 'http://localhost:' + server.address().port; });
test.after(() => server.close());

const X = { 'X-Requested-With': 'fetch' };

test('visitors see a generic message, never the setting names', async () => {
  const get = await fetch(base + '/api/feedback');
  assert.equal(get.status, 503);
  const post = await fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Hello there', content: 'This should not be saved yet.' }) });
  assert.equal(post.status, 503);
  for (const res of [get, post]) {
    const text = (await res.clone().json()).error;
    assert.match(text, /cannot be saved right now/);
    assert.ok(!/GOOGLE|README|sheet/i.test(text), 'no setup details for visitors: ' + text);
  }
});

test('admin can log in and the setup check names the missing settings', async () => {
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...X }, body: JSON.stringify({ password: 'test-pass-123' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/admin/feedback', { headers: { ...X, Cookie: cookie } })).status, 503);   // the list cannot load...
  const { checks } = await (await fetch(base + '/api/admin/status', { headers: { ...X, Cookie: cookie } })).json();   // ...but the check explains why
  const by = name => checks.find(c => c.name === name);
  assert.equal(by('GOOGLE_SHEET_ID').ok, false);
  assert.match(by('GOOGLE_SHEET_ID').message, /Missing/);
  assert.equal(by('GOOGLE_SERVICE_ACCOUNT_JSON').ok, false);
  assert.match(by('GOOGLE_SERVICE_ACCOUNT_JSON').message, /Missing/);
  assert.equal(by('Google Sheet access').ok, false);
  assert.equal(by('MAKE_WEBHOOK_URL').ok, true);

  process.env.GOOGLE_SHEET_ID = 'abc';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{oops, not json';
  const again = (await (await fetch(base + '/api/admin/status', { headers: { ...X, Cookie: cookie } })).json()).checks;
  assert.equal(again.find(c => c.name === 'GOOGLE_SHEET_ID').ok, true);
  assert.match(again.find(c => c.name === 'GOOGLE_SERVICE_ACCOUNT_JSON').message, /not valid JSON/);

  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: 'not a key' });
  const third = (await (await fetch(base + '/api/admin/status', { headers: { ...X, Cookie: cookie } })).json()).checks;
  assert.match(third.find(c => c.name === 'GOOGLE_SERVICE_ACCOUNT_JSON').message, /private_key/);
});

test('the status endpoint needs a login', async () => {
  assert.equal((await fetch(base + '/api/admin/status', { headers: X })).status, 401);
  assert.equal((await fetch(base + '/api/admin/status')).status, 400);
});
