'use strict';
// GET /api/admin/me -> 200 when the admin cookie is valid, otherwise 401
const { handle, sendJson } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { adminCounts } = require('../../lib/feedback');

module.exports = handle(async (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, { admin: true, counts: await adminCounts() });
}, { methods: ['GET'] });
