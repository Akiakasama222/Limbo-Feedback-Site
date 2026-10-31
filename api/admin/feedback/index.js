'use strict';
// GET /api/admin/feedback -> all feedback (newest first), including hidden ones
const { handle, sendJson } = require('../../../lib/http');
const { requireAdmin } = require('../../../lib/auth');
const { listAll } = require('../../../lib/feedback');

module.exports = handle(async (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, await listAll());
}, { methods: ['GET'] });
