'use strict';
// The same API tests, but the site talks to a (fake) Upstash Redis over REST - this exercises lib/store.js RedisStore.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMock } = require('./mock-upstash');
const mock = createMock('secret-token');

process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.PUBLIC_CACHE_SECONDS = '0';
delete process.env.VERCEL;
const { createServer } = require('../dev-server');
const { registerTests } = require('./shared');

let server, mockServer, base;
test.before(async () => {
  mockServer = mock.server;
  await new Promise(r => mockServer.listen(0, r));
  process.env.UPSTASH_REDIS_REST_URL = 'http://localhost:' + mockServer.address().port + '/';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret-token';
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); mockServer.close(); });
registerTests(() => base);

test('redis: data really lives in Redis keys (item + sorted sets) and writes are transactions', async () => {
  const keys = [...mock.strings.keys()].filter(k => k.includes(':item:'));
  assert.ok(keys.length > 0, 'item keys exist');
  assert.ok(mock.zsets.get('endless-survivor:all').size >= keys.length);
  assert.ok(mock.calls.multi > 0 && mock.calls.pipeline > 0);
  assert.equal(JSON.parse(mock.strings.get(keys[0]).value).id.length, 12);
});

test('redis: a wrong token is reported as a friendly 503', async () => {
  process.env.UPSTASH_REDIS_REST_TOKEN = 'wrong';
  delete require.cache[require.resolve('../lib/store')];
  for (const k of Object.keys(require.cache)) if (/feedback-site[\\/](lib|api)/.test(k)) delete require.cache[k];
  const { createServer: fresh } = require('../dev-server');
  const s = fresh(); await new Promise(r => s.listen(0, r));
  const res = await fetch('http://localhost:' + s.address().port + '/api/feedback');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not reachable/);
  s.close();
});
