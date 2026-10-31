'use strict';
// GET  /api/feedback?page=1  -> published feedback (public)
// POST /api/feedback         -> add feedback (the game calls this)
const { handle, sendJson } = require('../lib/http');
const { listPublic, createFeedback } = require('../lib/feedback');

module.exports = handle(async (req, res) => {
  if (req.method === 'POST') {
    const { pending } = await createFeedback(req);
    return sendJson(res, 201, { ok: true, pending });
  }
  // The public list may be cached for a few seconds by Vercel's edge, which saves database requests.
  const seconds = Number(process.env.PUBLIC_CACHE_SECONDS ?? 30);
  const headers = seconds > 0 ? { 'Cache-Control': 'public, max-age=0, s-maxage=' + seconds + ', stale-while-revalidate=' + seconds * 4 } : undefined;
  sendJson(res, 200, await listPublic(req.query && req.query.page), headers);
}, { methods: ['GET', 'POST'], cors: true });
