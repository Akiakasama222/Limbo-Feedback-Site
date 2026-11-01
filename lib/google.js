'use strict';
// Talking to the Google Sheets API with a "service account" (a robot Google account that you share the sheet with).
// Plain fetch() + Node's crypto, no npm packages.
const crypto = require('node:crypto');
const { httpError } = require('./http');

// The service account key. Paste the whole downloaded JSON file into GOOGLE_SERVICE_ACCOUNT_JSON
// (raw JSON or base64 of it). Alternative: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.
function serviceAccount() {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    try {
      const json = JSON.parse(raw);
      email = json.client_email;
      key = json.private_key;
    } catch (e) {
      console.error('[feedback] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
      return null;
    }
  }
  if (!email || !key) return null;
  return { email, key: key.replace(/\\n/g, '\n') };      // env variables often store line breaks as "\n"
}

const isConfigured = () => !!(process.env.GOOGLE_SHEET_ID && serviceAccount());

// Explains what is wrong with the service account setting (used by the admin "setup check").
function describeServiceAccount() {
  const hasJson = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const hasPair = !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  if (!hasJson && !hasPair) return { ok: false, problem: 'Missing. Paste the complete contents of your Google service account .json key file into this variable, then redeploy.' };
  const account = serviceAccount();
  if (!account) return { ok: false, problem: 'It is set, but it is not valid JSON or has no client_email / private_key. Paste the complete contents of the downloaded .json file (starting with { and ending with }).' };
  try {
    crypto.createPrivateKey(account.key);
  } catch (e) {
    return { ok: false, problem: 'The private_key inside it cannot be read (it may have lost its line breaks). Paste the .json file again, or use its base64 form.' };
  }
  return { ok: true, email: account.email };
}

const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SHEETS_API = () => process.env.GOOGLE_SHEETS_API || 'https://sheets.googleapis.com/v4';

let tokenCache = { token: '', expires: 0 };

function storageError(detail) {
  console.error('[feedback] Google Sheets problem:', detail);      // details go to the Vercel logs (and the admin setup check) only
  const err = httpError(503, 'The feedback sheet is not reachable right now. Please try again later.');
  err.detail = String(detail).slice(0, 500);                       // never sent to visitors; shown by /api/admin/status
  return err;
}

// Gets (and caches) an access token: we sign a small JWT with the service account's private key and Google swaps it for a token.
async function accessToken() {
  if (tokenCache.token && tokenCache.expires > Date.now() + 60000) return tokenCache.token;
  const account = serviceAccount();
  if (!account) throw storageError('service account is not configured');
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: account.email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL(),
    iat: now,
    exp: now + 3600
  });
  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.key).toString('base64url');
  } catch (e) {
    throw storageError('could not sign with the private key: ' + e.message);
  }
  let res, data;
  try {
    res = await fetch(TOKEN_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
      signal: AbortSignal.timeout(8000)
    });
    data = await res.json();
  } catch (e) {
    throw storageError('token request failed: ' + e.message);
  }
  if (!res.ok || !data.access_token) throw storageError('token request rejected: ' + JSON.stringify(data));
  tokenCache = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// Calls the Sheets API. `path` starts with "/spreadsheets/...". Returns the parsed JSON answer.
async function sheetsApi(method, path, body, retried) {
  const token = await accessToken();
  let res, data;
  try {
    res = await fetch(SHEETS_API() + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    data = await res.json();
  } catch (e) {
    throw storageError(method + ' ' + path + ' failed: ' + e.message);
  }
  if (res.status === 401 && !retried) { tokenCache = { token: '', expires: 0 }; return sheetsApi(method, path, body, true); }
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 404 ? ' (is the sheet shared with the service account email as Editor, and is GOOGLE_SHEET_ID right?)'
      : res.status === 400 ? ' (is the tab named exactly "Feedback"?)' : '';
    throw storageError(method + ' ' + path + ' -> HTTP ' + res.status + ' ' + JSON.stringify(data.error || data) + hint);
  }
  return data;
}

module.exports = { isConfigured, describeServiceAccount, sheetsApi, storageError };
