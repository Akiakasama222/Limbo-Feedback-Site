'use strict';
// Local test server that behaves like Vercel: serves public/ and runs the files in api/ as functions.
//
//   npm run dev        ->  http://localhost:3000   (admin: /admin)
//
// Without the Google Sheet variables it uses a temporary in-memory store. To test against your real sheet put the
// variables from .env.example into a file named .env.local - this file loads it automatically.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const API_DIR = path.join(ROOT, 'api');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Minimal .env.local loader (KEY=value lines).
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const isDir = p => fs.existsSync(p) && fs.statSync(p).isDirectory();

// Finds the api file for a URL, like Vercel does: file.js, folder/index.js and [param].js
function findApi(parts, dir = API_DIR, params = {}) {
  if (!parts.length) {
    const index = path.join(dir, 'index.js');
    return fs.existsSync(index) ? { file: index, params } : null;
  }
  const [seg, ...rest] = parts;
  if (!rest.length && fs.existsSync(path.join(dir, seg + '.js'))) return { file: path.join(dir, seg + '.js'), params };
  if (isDir(path.join(dir, seg))) {
    const found = findApi(rest, path.join(dir, seg), params);
    if (found) return found;
  }
  for (const entry of fs.readdirSync(dir)) {
    const m = entry.match(/^\[(\w+)\](\.js)?$/);
    if (!m) continue;
    const next = { ...params, [m[1]]: seg };
    if (m[2] && !rest.length) return { file: path.join(dir, entry), params: next };
    if (!m[2] && isDir(path.join(dir, entry))) {
      const found = findApi(rest, path.join(dir, entry), next);
      if (found) return found;
    }
  }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/admin') rel = '/admin.html';                       // same as "cleanUrls" on Vercel
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch (e) { decoded = ''; }
  const parts = decoded.split('/').filter(Boolean);
  const file = path.join(PUBLIC_DIR, ...parts);
  if (!decoded || parts.some(p => p.startsWith('.')) || !file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

// Reads the body the way Vercel does: JSON becomes req.body (an invalid JSON body throws when req.body is read).
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      let value = raw;
      let failed = false;
      if (type === 'application/json' && raw) { try { value = JSON.parse(raw); } catch (e) { failed = true; } }
      Object.defineProperty(req, 'body', { get() { if (failed) throw new Error('Invalid JSON'); return value; } });
      resolve();
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    const found = findApi(url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean));
    if (!found) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"Not found."}'); }
    req.query = { ...Object.fromEntries(url.searchParams), ...found.params };
    await readBody(req);
    await require(found.file)(req, res);
  });
}

module.exports = { createServer };

if (require.main === module) {
  loadEnvFile(path.join(ROOT, '.env.local'));
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log('\n  Feedback site (local test server)');
    console.log('  Public page : http://localhost:' + port + '/');
    console.log('  Admin panel : http://localhost:' + port + '/admin');
    if (!process.env.ADMIN_PASSWORD) console.log('  NOTE: set ADMIN_PASSWORD to log in, e.g.  ADMIN_PASSWORD=my-test-password npm run dev');
    console.log('');
  });
}
