'use strict';
// GET /api/site -> title and "Play" link shown on the public page
const { handle, sendJson } = require('../lib/http');

module.exports = handle((req, res) => {
  sendJson(res, 200, {
    title: process.env.SITE_TITLE || 'Limbo',
    gameUrl: process.env.GAME_URL || '',
    approval: process.env.REQUIRE_APPROVAL === '1'
  }, { 'Cache-Control': 'public, max-age=0, s-maxage=300' });
}, { methods: ['GET'], cors: true });
