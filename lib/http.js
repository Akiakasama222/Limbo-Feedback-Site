'use strict';
// Small helpers shared by every API function (plain Node req / res, so they run on Vercel and in dev-server.js).

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;       // the message is safe to show to the visitor
  return e;
}

// Sends a JSON response. `headers` can add / override headers (e.g. Set-Cookie, Cache-Control).
function sendJson(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [key, value] of Object.entries(headers || {})) res.setHeader(key, value);
  res.end(JSON.stringify(obj));
}

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[feedback] error:', err);     // shows up in the Vercel function logs
  if (res.headersSent) return res.end();
  sendJson(res, status, { error: err.expose ? err.message : 'Something went wrong on the server.' });
}

// Lets the game (hosted on another address) send feedback. Admin endpoints never use this.
// CORS_ORIGINS = comma separated list of allowed origins (default "*" = any site).
function applyCors(req, res) {
  const origins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (!origin) return;
  let allow = null;
  if (origins.includes('*')) allow = '*';
  else if (origins.includes(origin)) { allow = origin; res.setHeader('Vary', 'Origin'); }
  if (!allow) return;
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Wraps an API function: checks the HTTP method, handles CORS + preflight and turns thrown errors into JSON.
function handle(fn, { methods = ['GET'], cors = false } = {}) {
  return async (req, res) => {
    try {
      if (cors) {
        applyCors(req, res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
      }
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw httpError(405, 'Method not allowed.');
      }
      await fn(req, res);
    } catch (err) {
      sendError(res, err);
    }
  };
}

const MAX_BODY = 16 * 1024;

// Vercel parses JSON bodies into req.body for us.
function readJsonBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw httpError(415, 'Please send JSON.');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw httpError(413, 'Request is too large.');
  let body;
  try { body = req.body; } catch (e) { throw httpError(400, 'Invalid JSON.'); }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { throw httpError(400, 'Invalid JSON.'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Invalid JSON.');
  if (JSON.stringify(body).length > MAX_BODY) throw httpError(413, 'Request is too large.');
  return body;
}

// The visitor's IP address. On Vercel x-real-ip / x-forwarded-for hold the real client address (Vercel sets them itself).
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { httpError, sendJson, sendError, handle, readJsonBody, clientIp, sleep };
