'use strict';
// A fake Google (OAuth token endpoint + Sheets API) and a fake Make webhook, so the sheet code can be tested offline.
//   token   POST /token            (checks the signed JWT with the service account's public key)
//   sheets  /v4/spreadsheets/...   values.get, values.update, values.append, spreadsheets.get, batchUpdate (deleteDimension)
//   make    POST /hook             (acts like a Make scenario: "Add a Row" with Google's USER_ENTERED behaviour)
const http = require('node:http');
const crypto = require('node:crypto');

const HEADERS = ['id', 'createdAt', 'date', 'anonymous', 'name', 'title', 'content', 'hidden', 'edited', 'updatedAt', 'rating'];

function createMockGoogle({ sheetId = 'SHEET123', tab = 'Feedback', makeDelayMs = 0 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { client_email: 'robot@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const state = {
    rows: [HEADERS.slice()],              // rows[0] = header row (sheet row 1)
    tokenRequests: 0, apiRequests: [], makePayloads: [], valueInputOptions: [], formulaCells: 0
  };

  // What Google does with text typed into a cell ("USER_ENTERED"): ' in front of =+-@ hides the apostrophe, a leading = becomes a formula.
  const userEntered = v => {
    if (typeof v !== 'string') return v;
    if (/^'[=+\-@]/.test(v)) return v.slice(1);
    if (/^[=]/.test(v)) { state.formulaCells++; return '#NAME?'; }
    return v;
  };
  const trim = row => { const r = row.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined)) r.pop(); return r; };

  function verifyJwt(assertion) {
    const [h, c, sig] = assertion.split('.');
    const ok = crypto.createVerify('RSA-SHA256').update(h + '.' + c).verify(publicKey, Buffer.from(sig, 'base64url'));
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    return ok && claims.iss === account.client_email && claims.scope === 'https://www.googleapis.com/auth/spreadsheets' && claims.exp > claims.iat;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname);

      if (path === '/token' && req.method === 'POST') {
        state.tokenRequests++;
        const assertion = new URLSearchParams(raw).get('assertion') || '';
        return verifyJwt(assertion) ? send(200, { access_token: 'tok-' + state.tokenRequests, expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
      }

      if (path === '/hook' && req.method === 'POST') {
        const payload = JSON.parse(raw);
        state.makePayloads.push(payload);
        const add = () => state.rows.push(HEADERS.map(h => userEntered(payload[h])));
        if (makeDelayMs) setTimeout(add, makeDelayMs); else add();
        res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end('Accepted');
      }

      if (!path.startsWith('/v4/spreadsheets/')) return send(404, { error: 'not found' });
      if (req.headers.authorization !== 'Bearer tok-' + state.tokenRequests && !/^Bearer tok-\d+$/.test(req.headers.authorization || '')) return send(401, { error: { code: 401, message: 'bad token' } });
      state.apiRequests.push(req.method + ' ' + path);
      const rest = path.slice('/v4/spreadsheets/'.length);
      if (!rest.startsWith(sheetId)) return send(404, { error: { code: 404, message: 'Requested entity was not found.' } });
      const after = rest.slice(sheetId.length);
      const valueInputOption = url.searchParams.get('valueInputOption');
      const cell = text => (valueInputOption === 'RAW' ? text : userEntered(text));

      if (after === '' && req.method === 'GET') return send(200, { sheets: [{ properties: { sheetId: 777, title: tab } }] });
      if (after === ':batchUpdate' && req.method === 'POST') {
        for (const r of JSON.parse(raw).requests) {
          const range = r.deleteDimension.range;
          if (range.sheetId !== 777 || range.dimension !== 'ROWS') return send(400, { error: { message: 'bad range' } });
          state.rows.splice(range.startIndex, range.endIndex - range.startIndex);
        }
        return send(200, { replies: [{}] });
      }
      const m = after.match(/^\/values\/'?([^!]*?)'?!(.+)$/);
      if (m) {
        if (m[1] !== tab) return send(400, { error: { code: 400, message: 'Unable to parse range' } });
        const a1 = m[2];
        if (req.method === 'GET') {
          if (url.searchParams.get('valueRenderOption') !== 'UNFORMATTED_VALUE') return send(400, { error: { message: 'expected UNFORMATTED_VALUE' } });
          const r = a1.match(/^A(\d+):[A-Z](\d*)$/);                           // honour the row numbers in the range (A2:J = from row 2, A1:J1 = header only)
          const from = Number(r[1]) - 1, to = r[2] ? Number(r[2]) : undefined;
          return send(200, { range: a1, majorDimension: 'ROWS', values: state.rows.slice(from, to).map(trim) });
        }
        if (req.method === 'PUT') {
          state.valueInputOptions.push(valueInputOption);
          const row = Number(a1.match(/^A(\d+):K\d+$/)[1]);
          if (row < 2 || row > state.rows.length) return send(400, { error: { message: 'row out of range' } });
          state.rows[row - 1] = JSON.parse(raw).values[0].map(cell);
          return send(200, { updatedRows: 1 });
        }
        if (req.method === 'POST' && a1.endsWith(':append')) {
          state.valueInputOptions.push(valueInputOption);
          state.rows.push(JSON.parse(raw).values[0].map(cell));
          return send(200, { updates: { updatedRows: 1 } });
        }
      }
      send(404, { error: { message: 'unhandled ' + req.method + ' ' + path } });
    });
  });
  return { server, state, account };
}

module.exports = { createMockGoogle, HEADERS };
