'use strict';
// A tiny fake of the Upstash Redis REST API (only the commands the site uses), so the Redis code path can be tested offline.
//   POST /pipeline and POST /multi-exec  with  [["SET","k","v"], ["GET","k"], ...]  ->  [{"result":...}, ...]
const http = require('node:http');

function createMock(token) {
  const strings = new Map();      // key -> { value, expires }
  const zsets = new Map();        // key -> Map(member -> score)
  const live = key => { const e = strings.get(key); if (e && e.expires && e.expires <= Date.now()) { strings.delete(key); return null; } return e || null; };
  const zset = key => { if (!zsets.has(key)) zsets.set(key, new Map()); return zsets.get(key); };

  function exec([cmd, ...a]) {
    switch (String(cmd).toUpperCase()) {
      case 'SET': {
        const [key, value, ...opts] = a.map(String);
        const nx = opts.map(o => o.toUpperCase()).includes('NX');
        const exAt = opts.findIndex(o => o.toUpperCase() === 'EX');
        if (nx && live(key)) return null;
        strings.set(key, { value, expires: exAt >= 0 ? Date.now() + Number(opts[exAt + 1]) * 1000 : 0 });
        return 'OK';
      }
      case 'GET': { const e = live(String(a[0])); return e ? e.value : null; }
      case 'MGET': return a.map(k => { const e = live(String(k)); return e ? e.value : null; });
      case 'DEL': { let n = 0; for (const k of a) { if (strings.delete(String(k))) n++; if (zsets.delete(String(k))) n++; } return n; }
      case 'INCR': { const key = String(a[0]); const e = live(key) || { value: '0', expires: 0 }; e.value = String(Number(e.value) + 1); strings.set(key, e); return Number(e.value); }
      case 'ZADD': { const z = zset(String(a[0])); const had = z.has(String(a[2])); z.set(String(a[2]), Number(a[1])); return had ? 0 : 1; }
      case 'ZREM': return zset(String(a[0])).delete(String(a[1])) ? 1 : 0;
      case 'ZCARD': return zset(String(a[0])).size;
      case 'ZREVRANGE': {
        const sorted = [...zset(String(a[0])).entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? 1 : -1)).map(e => e[0]);
        const start = Number(a[1]), stop = Number(a[2]);
        return sorted.slice(start, stop < 0 ? undefined : stop + 1);
      }
      default: throw new Error('ERR unknown command ' + cmd);
    }
  }

  const calls = { pipeline: 0, multi: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== 'Bearer ' + token) return send(401, { error: 'Unauthorized' });
      let commands;
      try { commands = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { error: 'bad json' }); }
      if (req.url === '/pipeline') calls.pipeline++; else if (req.url === '/multi-exec') calls.multi++; else return send(404, { error: 'not found' });
      send(200, commands.map(c => { try { return { result: exec(c) }; } catch (e) { return { error: e.message }; } }));
    });
  });
  return { server, calls, strings, zsets };
}

module.exports = { createMock };
