'use strict';
// POST /api/admin/logout -> clears the admin cookie
const { handle, sendJson } = require('../../lib/http');
const { sessionCookie, requireAjaxHeader } = require('../../lib/auth');

module.exports = handle((req, res) => {
  requireAjaxHeader(req);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}, { methods: ['POST'] });
