'use strict';
// The feedback "business rules": adding, listing, editing and deleting feedback.
const crypto = require('node:crypto');
const { httpError, clientIp, readJsonBody } = require('./http');
const { LIMITS, cleanText } = require('./validate');
const { getStore } = require('./store');
const { rateCount, rateAdd } = require('./limiter');

const PAGE_SIZE = 20;                    // feedback cards per page on the public site
const ADMIN_LIMIT = 1000;                // newest feedback the admin panel loads at once
const SUBMIT_WINDOW_SECONDS = 10 * 60;   // "SUBMIT_MAX feedback per visitor per 10 minutes"
const SUBMIT_MAX = () => Number(process.env.SUBMIT_MAX) || 5;
const REQUIRE_APPROVAL = () => process.env.REQUIRE_APPROVAL === '1';

// What visitors see of one feedback.
function publicItem(it) {
  return { id: it.id, name: it.anonymous ? 'Anonymous' : it.name, anonymous: it.anonymous, title: it.title, content: it.content, createdAt: it.createdAt, edited: !!it.edited };
}

// ---- public ----
async function listPublic(pageParam) {
  const store = getStore();
  let page = Math.max(1, parseInt(pageParam, 10) || 1);
  let result = await store.listPublic(page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  if (page > pages) { page = pages; result = await store.listPublic(page, PAGE_SIZE); }
  return { items: result.items.map(publicItem), total: result.total, page, pages };
}

// Adds feedback sent by the game. Returns { pending } (true when it waits for your approval).
async function createFeedback(req) {
  const store = getStore();
  const ip = clientIp(req);
  const limitKey = 'submit:' + ip;
  if (rateCount(limitKey) >= SUBMIT_MAX()) {
    throw httpError(429, 'You have sent a lot of feedback recently. Please try again in a few minutes.');
  }
  const body = readJsonBody(req);
  const useName = body.anonymous === false;
  const item = {
    id: 'f' + crypto.randomBytes(6).toString('hex').slice(1),      // starts with a letter so Google Sheets never turns it into a number
    anonymous: !useName,
    name: useName ? cleanText(body.name, 'Name', { min: 1, max: LIMITS.name }) : '',
    title: cleanText(body.title, 'Title', { min: LIMITS.titleMin, max: LIMITS.title }),
    content: cleanText(body.content, 'Feedback', { min: LIMITS.contentMin, max: LIMITS.content, multiline: true }),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    edited: false,
    hidden: REQUIRE_APPROVAL()
  };
  await store.createItem(item);
  rateAdd(limitKey, SUBMIT_WINDOW_SECONDS);
  return { pending: item.hidden };
}

// ---- admin ----
async function listAll() {
  const { items, counts } = await getStore().listAll(ADMIN_LIMIT);
  return { items, counts };
}

async function adminCounts() {
  return getStore().counts();
}

// Edit name / title / content and / or hide or show one feedback.
async function updateFeedback(id, body) {
  const store = getStore();
  const item = await store.getItem(id);
  if (!item) throw httpError(404, 'That feedback no longer exists.');
  const next = { ...item };
  if ('title' in body) next.title = cleanText(body.title, 'Title', { min: LIMITS.titleMin, max: LIMITS.title });
  if ('content' in body) next.content = cleanText(body.content, 'Feedback', { min: LIMITS.contentMin, max: LIMITS.content, multiline: true });
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name) { next.name = cleanText(name, 'Name', { min: 1, max: LIMITS.name }); next.anonymous = false; }
    else { next.name = ''; next.anonymous = true; }          // empty name = shown as Anonymous
  }
  if ('hidden' in body) {
    if (typeof body.hidden !== 'boolean') throw httpError(400, 'hidden must be true or false.');
    next.hidden = body.hidden;
  }
  if (next.title !== item.title || next.content !== item.content || next.name !== item.name) {
    next.edited = true;
    next.updatedAt = new Date().toISOString();
  }
  await store.saveItem(next);
  return { item: next, counts: await store.counts() };
}

async function deleteFeedback(id) {
  const store = getStore();
  if (!(await store.getItem(id))) throw httpError(404, 'That feedback no longer exists.');
  await store.deleteItem(id);
  return { counts: await store.counts() };
}

module.exports = { listPublic, createFeedback, listAll, adminCounts, updateFeedback, deleteFeedback };
