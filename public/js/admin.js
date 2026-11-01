'use strict';
// Admin panel: log in, then edit, hide / show or delete feedback.
// Everything from players is added with textContent (never innerHTML), so it can never run as code.

const $ = id => document.getElementById(id);
const LIMITS = { name: 30, title: 80, content: 1500 };   // same limits as server.js
let items = [];          // all feedback, newest first
let counts = null;

// ---------- talking to the server ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: Object.assign({ 'X-Requested-With': 'fetch' }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (res.status === 401 && url !== '/api/admin/login') { showLogin(); throw new Error('Please log in again.'); }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed (' + res.status + ')');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- screens ----------
function showLogin() {
  $('panel').hidden = true;
  $('loginBox').hidden = false;
  $('password').value = '';
  $('password').focus();
}

function showPanel() {
  $('loginBox').hidden = true;
  $('panel').hidden = false;
}

async function login() {
  $('loginMsg').textContent = '';
  $('loginBtn').disabled = true;
  try {
    await api('POST', '/api/admin/login', { password: $('password').value });
  } catch (e) {
    $('loginMsg').textContent = e.message;
    return;
  } finally {
    $('loginBtn').disabled = false;
  }
  showPanel();
  await loadOrExplain();
}

async function logout() {
  try { await api('POST', '/api/admin/logout'); } catch (e) { /* ignore */ }
  items = [];
  showLogin();
}

async function loadAll() {
  const data = await api('GET', '/api/admin/feedback');
  items = data.items;
  counts = data.counts;
  render();
}

// Loads the feedback; if that fails (e.g. the Google Sheet is not set up yet) shows the setup check instead of an empty page.
async function loadOrExplain() {
  $('setup').hidden = true;
  try {
    await loadAll();
  } catch (e) {
    if (e.status === 401) return;                       // api() already showed the login box
    items = [];
    counts = { total: 0, published: 0, hidden: 0 };
    render();
    $('status').textContent = '';                       // ("No feedback yet" would be misleading here)
    await showSetupCheck(e.message);
  }
}

// Fills the "Setup check" box with one line per check (green tick = fine, red cross = fix this).
async function showSetupCheck(problem) {
  $('setup').hidden = false;
  $('setupIntro').textContent = 'The feedback could not be loaded: ' + problem + ' Here is what is wrong:';
  const list = $('setupList');
  list.replaceChildren();
  let checks = [];
  try {
    checks = (await api('GET', '/api/admin/status')).checks;
  } catch (e) {
    checks = [{ name: 'Setup check', ok: false, message: e.message }];
  }
  for (const check of checks) {
    const li = document.createElement('li');
    li.className = check.ok ? 'ok' : 'bad';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = check.ok ? '✔' : '✖';
    const body = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = check.name;
    body.append(name, document.createTextNode(check.message));
    li.append(mark, body);
    list.append(li);
  }
}

// ---------- drawing the list ----------
function matchesFilter(item) {
  const f = $('filter').value;
  if (f === 'published' && item.hidden) return false;
  if (f === 'hidden' && !item.hidden) return false;
  const q = $('search').value.trim().toLowerCase();
  if (!q) return true;
  return (item.title + ' ' + item.content + ' ' + (item.anonymous ? 'anonymous' : item.name) + (item.rating ? ' ' + item.rating + ' stars' : '')).toLowerCase().includes(q);
}

function render() {
  $('counts').textContent = counts.total + ' total · ' + counts.published + ' published · ' + counts.hidden + ' hidden';
  const list = $('list');
  list.replaceChildren();
  const shown = items.filter(matchesFilter);
  $('status').textContent = shown.length ? '' : (items.length ? 'Nothing matches your search.' : 'No feedback yet.');
  if (shown.length && counts.total > items.length) $('status').textContent = 'Showing the newest ' + items.length + ' of ' + counts.total + '.';
  for (const item of shown) list.append(makeCard(item));
}

function button(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small ' + className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card' + (item.hidden ? ' is-hidden' : '');

  const ratingOnly = !item.title && !item.content;           // stars without a written comment
  const title = document.createElement('h2');
  title.textContent = item.title;
  const text = document.createElement('p');
  text.className = 'text' + (ratingOnly ? ' muted' : '');
  text.textContent = ratingOnly ? 'Rating only - no written comment.' : item.content;

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (item.rating) {
    const rate = document.createElement('span');
    rate.className = 'rate';
    rate.textContent = '★'.repeat(item.rating) + '☆'.repeat(5 - item.rating);
    rate.title = item.rating + ' of 5 stars';
    meta.append(rate);
  }
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = item.anonymous ? 'Anonymous' : item.name;
  const when = document.createElement('time');
  when.textContent = new Date(item.createdAt).toLocaleString();
  meta.append(who, when);
  const status = document.createElement('span');
  status.className = 'tag' + (item.hidden ? ' bad' : '');
  status.textContent = item.hidden ? 'hidden' : 'published';
  meta.append(status);
  if (item.edited) {
    const edited = document.createElement('span');
    edited.className = 'tag';
    edited.textContent = 'edited';
    meta.append(edited);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    button('Edit', 'ghost', () => card.replaceWith(makeEditor(item))),
    button(item.hidden ? 'Show' : 'Hide', 'ghost', () => update(item, { hidden: !item.hidden })),
    button('Delete', 'danger', () => remove(item))
  );

  if (ratingOnly) card.append(text, meta, actions);
  else card.append(title, text, meta, actions);
  return card;
}

// The edit form that replaces a card while you edit it.
function makeEditor(item) {
  const card = document.createElement('article');
  card.className = 'card edit-form';

  const field = (labelText, el) => {
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = labelText;
    card.append(label, el);
  };

  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = LIMITS.name;
  name.value = item.anonymous ? '' : item.name;
  name.placeholder = 'Empty = shown as Anonymous';
  const title = document.createElement('input');
  title.type = 'text';
  title.maxLength = LIMITS.title;
  title.value = item.title;
  const content = document.createElement('textarea');
  content.maxLength = LIMITS.content;
  content.value = item.content;

  if (!item.title && !item.content) {                        // a stars-only entry has no comment to edit
    title.placeholder = content.placeholder = '(none - rating only)';
  }
  field('Name', name);
  field('Title', title);
  field('Feedback', content);

  const msg = document.createElement('p');
  msg.className = 'msg';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const save = button('Save', '', async () => {
    save.disabled = true;
    try {
      await update(item, { name: name.value, title: title.value, content: content.value }, true);
    } catch (e) {
      msg.textContent = e.message;
      save.disabled = false;
    }
  });
  actions.append(save, button('Cancel', 'ghost', () => card.replaceWith(makeCard(item))));
  card.append(msg, actions);
  return card;
}

// ---------- changing data ----------
async function update(item, changes, rethrow) {
  try {
    const data = await api('PATCH', '/api/admin/feedback/' + item.id, changes);
    const i = items.findIndex(x => x.id === item.id);
    if (i >= 0) items[i] = data.item;
    counts = data.counts;
    render();
  } catch (e) {
    if (rethrow) throw e;
    alert(e.message);
  }
}

async function remove(item) {
  if (!confirm('Delete this feedback permanently?\n\n"' + (item.title || 'Rating only') + '"')) return;
  try {
    const data = await api('DELETE', '/api/admin/feedback/' + item.id);
    items = items.filter(x => x.id !== item.id);
    counts = data.counts;
    render();
  } catch (e) {
    alert(e.message);
  }
}

// Downloads everything that is loaded as a .json file (a simple backup).
function downloadBackup() {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'feedback-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- start ----------
$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('logoutBtn').addEventListener('click', logout);
$('backupBtn').addEventListener('click', downloadBackup);
$('retryBtn').addEventListener('click', loadOrExplain);
$('search').addEventListener('input', render);
$('filter').addEventListener('change', render);

// Already logged in (cookie still valid)? Go straight to the panel.
(async () => {
  try {
    await api('GET', '/api/admin/me');
  } catch (e) {
    if (e.status === 401) return showLogin();
  }
  showPanel();
  await loadOrExplain();
})();
