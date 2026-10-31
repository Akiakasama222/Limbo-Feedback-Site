'use strict';
// API tests with the temporary in-memory store.
const test = require('node:test');
process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.PUBLIC_CACHE_SECONDS = '0';
delete process.env.GOOGLE_SHEET_ID; delete process.env.VERCEL;
const { createServer } = require('../dev-server');
const { registerTests } = require('./shared');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, r)); base = 'http://localhost:' + server.address().port; });
test.after(() => server.close());
registerTests(() => base);
