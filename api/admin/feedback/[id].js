'use strict';
// PATCH  /api/admin/feedback/:id {name, title, content, hidden} -> edit / hide / show
// DELETE /api/admin/feedback/:id                                -> delete
const { handle, sendJson, httpError, readJsonBody } = require('../../../lib/http');
const { requireAdmin } = require('../../../lib/auth');
const { updateFeedback, deleteFeedback } = require('../../../lib/feedback');

module.exports = handle(async (req, res) => {
  requireAdmin(req);
  const id = String((req.query && req.query.id) || '');
  if (!/^f[a-f0-9]{11}$/.test(id)) throw httpError(404, 'Not found.');
  if (req.method === 'DELETE') return sendJson(res, 200, { ok: true, ...(await deleteFeedback(id)) });
  sendJson(res, 200, { ok: true, ...(await updateFeedback(id, readJsonBody(req))) });
}, { methods: ['PATCH', 'DELETE'] });
