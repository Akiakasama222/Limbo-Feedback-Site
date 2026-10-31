'use strict';
// Admin login: one password (ADMIN_PASSWORD environment variable) and a signed, HTTP-only session cookie.
// The cookie is stateless (no database lookup): "<expiry>.<signature>".
const crypto = require('node:crypto');
const { httpError } = require('./http');

const COOKIE_NAME = 'es_admin';
const SESSION_SECONDS = 12 * 60 * 60;            // stay logged in for 12 hours

function adminPassword() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) throw httpError(503, 'Admin is not set up yet: add an ADMIN_PASSWORD environment variable (8+ characters).');
  return password;
}

const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

// Compares the typed password with ADMIN_PASSWORD in constant time (both are hashed to the same length first).
function passwordMatches(input) {
  return crypto.timingSafeEqual(hmac('compare', String(input)), hmac('compare', adminPassword()));
}

// Secret used to sign the cookie. Changing ADMIN_PASSWORD (or SESSION_SECRET) logs everybody out.
const secret = () => process.env.SESSION_SECRET ? process.env.SESSION_SECRET + adminPassword() : adminPassword();
const sign = value => hmac(secret(), 'session:' + value).toString('base64url');

function makeSessionToken() {
  const expires = String(Date.now() + SESSION_SECONDS * 1000);
  return expires + '.' + sign(expires);
}

function sessionIsValid(token) {
  if (!token || typeof token !== 'string') return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(expires));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expires) > Date.now();
}

function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// Secure cookies on Vercel (always https); plain on localhost.
const useSecureCookie = () => !!process.env.VERCEL || process.env.COOKIE_SECURE === '1';

function sessionCookie(token, maxAgeSeconds) {
  return COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=' + maxAgeSeconds + (useSecureCookie() ? '; Secure' : '');
}

// Extra CSRF guard: other websites cannot add this header to a request without our permission.
function requireAjaxHeader(req) {
  if (req.headers['x-requested-with'] !== 'fetch') throw httpError(400, 'Bad request.');
}

// Every admin endpoint (except login / logout) starts with this.
function requireAdmin(req) {
  requireAjaxHeader(req);
  if (!sessionIsValid(getCookie(req, COOKIE_NAME))) throw httpError(401, 'Please log in.');
}

module.exports = { SESSION_SECONDS, passwordMatches, makeSessionToken, sessionCookie, requireAjaxHeader, requireAdmin };
