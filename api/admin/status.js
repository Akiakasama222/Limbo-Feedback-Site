'use strict';
// GET /api/admin/status -> setup check for the owner (only available after logging in)
const { handle, sendJson } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { checkSetup } = require('../../lib/setup');

module.exports = handle(async (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, { checks: await checkSetup() });
}, { methods: ['GET'] });
