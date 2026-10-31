'use strict';
// POST /api/admin/login {password} -> sets the admin cookie. Five wrong passwords lock that visitor out for 15 minutes.
const { handle, sendJson, httpError, readJsonBody, clientIp, sleep } = require('../../lib/http');
const { passwordMatches, makeSessionToken, sessionCookie, requireAjaxHeader, SESSION_SECONDS } = require('../../lib/auth');
const { rateCount, rateAdd, rateReset } = require('../../lib/limiter');

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

module.exports = handle(async (req, res) => {
  requireAjaxHeader(req);
  const key = 'login:' + clientIp(req);
  if (rateCount(key) >= LOGIN_MAX_FAILS) throw httpError(429, 'Too many wrong passwords. Try again in 15 minutes.');
  const body = readJsonBody(req);
  const ok = typeof body.password === 'string' && body.password.length <= 200 && passwordMatches(body.password);
  if (!ok) {
    rateAdd(key, LOGIN_WINDOW_SECONDS);
    await sleep(600);                                   // slows down guessing
    throw httpError(401, 'Wrong password.');
  }
  rateReset(key);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(makeSessionToken(), SESSION_SECONDS) });
}, { methods: ['POST'] });
