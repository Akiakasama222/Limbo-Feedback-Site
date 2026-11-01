'use strict';
// Where feedback is saved.
//   * Production: a Google Sheet (the "database"). New feedback is sent to your Make webhook, which adds the row
//     (or, if MAKE_WEBHOOK_URL is empty, the site adds the row itself through the Google Sheets API).
//     The site reads, edits, hides and deletes rows through the Google Sheets API.
//   * Local testing without a sheet: a temporary in-memory store (data disappears when you stop it).
//
// Sheet layout (tab "Feedback", header in row 1, one feedback per row):
//   A id | B createdAt | C date | D anonymous | E name | F title | G content | H hidden | I edited | J updatedAt | K rating
//   createdAt / updatedAt = milliseconds since 1970 (numbers never get mangled by Sheets); "date" is only for you to read.
//   rating = 1-5 stars (empty for feedback without a rating). A row with a rating but no title / content is a "rating only".
//   Rows are only read by position, so the header names in row 1 are just labels for you (and for Make's column mapping).
const { httpError } = require('./http');
const { isConfigured, sheetsApi, storageError } = require('./google');

const COLUMNS = ['id', 'createdAt', 'date', 'anonymous', 'name', 'title', 'content', 'hidden', 'edited', 'updatedAt', 'rating'];
const LAST_COLUMN = 'K';
const ID_PATTERN = /^f[a-f0-9]{11}$/;

// ---------------------------------------------------------------------------
// Converting between a feedback item and a sheet row
// ---------------------------------------------------------------------------

// A cell that starts with = + - @ could run as a formula in Google Sheets. We put a ' in front of such text.
// (Google hides that ' in the cell; if the cell was written as raw text we remove it again when reading.)
const FORMULA_START = /^[=+\-@\t\r]/;
const protect = text => (typeof text === 'string' && FORMULA_START.test(text) ? "'" + text : text);
const unprotect = text => (/^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text);

const truthy = v => v === true || ['true', '1', 'yes', 'y'].includes(String(v).trim().toLowerCase());
const text = v => (v === undefined || v === null ? '' : String(v));

// Milliseconds from a sheet value: epoch milliseconds, an ISO date text, or a Sheets date number.
function parseTime(v) {
  if (typeof v === 'number') return v > 1e11 ? v : Math.round((v - 25569) * 86400000);
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v.trim())) return parseTime(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

// Stars from a sheet cell: 1-5, anything else = no rating.
function parseStoredRating(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 && String(v).trim() !== '' ? n : null;
}

// Does this item have a written comment (as opposed to a rating only)?
const hasText = item => !!(item.title.trim() || item.content.trim());

// One row of the sheet -> feedback item (null if the row is not usable).
function fromRow(row) {
  const id = text(row[0]).trim();
  if (!ID_PATTERN.test(id)) return null;
  const createdMs = parseTime(row[1]);
  const title = unprotect(text(row[5]));
  const content = unprotect(text(row[6]));
  const rating = parseStoredRating(row[10]);
  const written = !!(title.trim() || content.trim());
  if (Number.isNaN(createdMs)) return null;
  if (written ? !(title.trim() && content.trim()) : !rating) return null;      // needs title AND content, or just a rating
  const name = unprotect(text(row[4])).trim();
  const updatedMs = parseTime(row[9]);
  return {
    id,
    anonymous: truthy(row[3]) || !name,
    name: truthy(row[3]) ? '' : name,
    title,
    content,
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: Number.isNaN(updatedMs) ? null : new Date(updatedMs).toISOString(),
    edited: truthy(row[8]),
    hidden: truthy(row[7]),
    rating
  };
}

// Feedback item -> the values for the columns A..J (as an object, used for the Make webhook, and as an array).
function toRecord(item) {
  return {
    id: item.id,
    createdAt: Date.parse(item.createdAt),
    date: item.createdAt,
    anonymous: item.anonymous,
    name: protect(item.name),
    title: protect(item.title),
    content: protect(item.content),
    hidden: item.hidden,
    edited: item.edited,
    updatedAt: item.updatedAt ? Date.parse(item.updatedAt) : '',
    rating: item.rating || ''
  };
}
const toRow = item => COLUMNS.map(column => toRecord(item)[column]);

// ---------------------------------------------------------------------------
// Google Sheet store
// ---------------------------------------------------------------------------
class SheetsStore {
  constructor() {
    this.cache = null;          // parsed rows
    this.cacheAt = 0;
    this.pending = null;        // a read that is already running (shared by simultaneous visitors)
    this.sheetGid = null;       // numeric id of the tab (needed to delete rows)
  }

  get spreadsheetId() { return encodeURIComponent(process.env.GOOGLE_SHEET_ID); }
  get tab() { return process.env.GOOGLE_SHEET_TAB || 'Feedback'; }
  range(a1) { return encodeURIComponent("'" + this.tab.replace(/'/g, "''") + "'!" + a1); }
  invalidate() { this.cache = null; }

  // All feedback rows, newest first. Cached for SHEET_CACHE_SECONDS (default 10) to save Google requests.
  async readRows(force) {
    const ttl = Number(process.env.SHEET_CACHE_SECONDS ?? 10) * 1000;
    if (!force && this.cache && Date.now() - this.cacheAt < ttl) return this.cache;
    if (!force && this.pending) return this.pending;
    const job = (async () => {
      const data = await sheetsApi('GET', '/spreadsheets/' + this.spreadsheetId + '/values/' + this.range('A2:' + LAST_COLUMN) + '?valueRenderOption=UNFORMATTED_VALUE');
      const rows = [];
      (data.values || []).forEach((values, index) => {
        const item = fromRow(values);
        if (item) rows.push({ rowNumber: index + 2, item });
      });
      rows.sort((a, b) => Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt) || b.rowNumber - a.rowNumber);
      this.cache = rows;
      this.cacheAt = Date.now();
      return rows;
    })();
    this.pending = job;
    try { return await job; } finally { if (this.pending === job) this.pending = null; }
  }

  async createItem(item) {
    const hook = process.env.MAKE_WEBHOOK_URL;
    if (hook) {
      // Hand the feedback to Make; the Make scenario adds the row to the sheet.
      let res;
      try {
        res = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toRecord(item)),
          signal: AbortSignal.timeout(10000)
        });
      } catch (e) {
        throw storageError('Make webhook request failed: ' + e.message);
      }
      if (!res.ok) throw storageError('Make webhook answered HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
    } else {
      await sheetsApi('POST', '/spreadsheets/' + this.spreadsheetId + '/values/' + this.range('A:' + LAST_COLUMN) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: [toRow(item)] });
    }
    this.invalidate();
  }

  async findRow(id) {
    const rows = await this.readRows(true);                      // always fresh before changing something
    return rows.find(r => r.item.id === id) || null;
  }

  async getItem(id) {
    const row = await this.findRow(id);
    return row ? row.item : null;
  }

  async saveItem(item) {
    const row = await this.findRow(item.id);
    if (!row) throw httpError(404, 'That feedback no longer exists.');
    await sheetsApi('PUT', '/spreadsheets/' + this.spreadsheetId + '/values/' + this.range('A' + row.rowNumber + ':' + LAST_COLUMN + row.rowNumber) + '?valueInputOption=RAW', { values: [toRow(item)] });
    this.invalidate();
  }

  async deleteItem(id) {
    const row = await this.findRow(id);
    if (!row) throw httpError(404, 'That feedback no longer exists.');
    if (this.sheetGid === null) {
      const info = await sheetsApi('GET', '/spreadsheets/' + this.spreadsheetId + '?fields=sheets.properties(sheetId,title)');
      const sheet = (info.sheets || []).find(s => s.properties.title === this.tab);
      if (!sheet) throw storageError('tab "' + this.tab + '" was not found in the spreadsheet');
      this.sheetGid = sheet.properties.sheetId;
    }
    await sheetsApi('POST', '/spreadsheets/' + this.spreadsheetId + ':batchUpdate', {
      requests: [{ deleteDimension: { range: { sheetId: this.sheetGid, dimension: 'ROWS', startIndex: row.rowNumber - 1, endIndex: row.rowNumber } } }]
    });
    this.invalidate();
  }

  // For the admin "setup check": reads the header row and counts the rows.
  async diagnose() {
    const data = await sheetsApi('GET', '/spreadsheets/' + this.spreadsheetId + '/values/' + this.range('A1:' + LAST_COLUMN + '1') + '?valueRenderOption=UNFORMATTED_VALUE');
    const headers = ((data.values || [])[0] || []).map(h => String(h).trim());
    const rows = await this.readRows(true);
    return { headers, rows: rows.length };
  }

  // One page of written feedback (rating-only entries are not listed as cards), newest first.
  async listPublic(page, perPage) {
    const visible = (await this.readRows()).filter(r => !r.item.hidden && hasText(r.item)).map(r => r.item);
    return { total: visible.length, items: visible.slice((page - 1) * perPage, page * perPage) };
  }

  async ratingStats() {
    return statsOf((await this.readRows()).map(r => r.item));
  }

  async listAll(limit) {
    const rows = await this.readRows();
    const items = rows.map(r => r.item);
    return { items: items.slice(0, limit), counts: countsOf(items) };
  }

  async counts() {
    return countsOf((await this.readRows()).map(r => r.item));
  }
}

// Star statistics of everything that is visible: how many 1..5 star ratings and the average.
const statsOf = items => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const it of items) {
    if (it.hidden || !it.rating) continue;
    counts[it.rating]++;
    sum += it.rating;
    count++;
  }
  return { count, average: count ? Math.round(sum / count * 100) / 100 : 0, counts };
};

const countsOf = items => {
  const hidden = items.filter(it => it.hidden).length;
  return { total: items.length, published: items.length - hidden, hidden };
};

// ---------------------------------------------------------------------------
// Temporary in-memory store (local testing only)
// ---------------------------------------------------------------------------
class MemoryStore {
  constructor() { this.items = new Map(); }
  newestFirst(filter) {
    return [...this.items.values()].filter(filter).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
  }
  async createItem(item) { this.items.set(item.id, { ...item }); }
  async getItem(id) { const it = this.items.get(id); return it ? { ...it } : null; }
  async saveItem(item) { this.items.set(item.id, { ...item }); }
  async deleteItem(id) { this.items.delete(id); }
  async listPublic(page, perPage) {
    const all = this.newestFirst(it => !it.hidden && hasText(it));
    return { total: all.length, items: all.slice((page - 1) * perPage, page * perPage) };
  }
  async ratingStats() { return statsOf([...this.items.values()]); }
  async listAll(limit) { return { items: this.newestFirst(() => true).slice(0, limit), counts: await this.counts() }; }
  async counts() { return countsOf([...this.items.values()]); }
}

// ---------------------------------------------------------------------------
let store = null;

function getStore() {
  if (store) return store;
  if (isConfigured()) {
    store = new SheetsStore();
  } else if (!process.env.VERCEL) {
    console.warn('[feedback] No Google Sheet configured - using TEMPORARY in-memory storage (data is lost when this stops).');
    store = new MemoryStore();
  } else {
    console.error('[feedback] Storage is not set up: GOOGLE_SHEET_ID and / or GOOGLE_SERVICE_ACCOUNT_JSON are missing or invalid (log in to /admin for the setup check).');
    throw httpError(503, 'Feedback cannot be saved right now. Please try again later.');
  }
  return store;
}

module.exports = { getStore, COLUMNS };
