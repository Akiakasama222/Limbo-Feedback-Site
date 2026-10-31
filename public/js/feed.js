'use strict';
// Public feedback page: loads the published feedback from /api/feedback and shows it as cards.
// Everything from players is added with textContent (never innerHTML), so it can never run as code.

const $ = id => document.getElementById(id);
let nextPage = 1;       // page of feedback to load next
let totalPages = 1;
let loading = false;

// "3 days ago" style text (the full date is shown when hovering over it).
function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
  }
  return 'just now';
}

// Builds one feedback card.
function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const title = document.createElement('h2');
  title.textContent = item.title;

  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = item.content;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = item.name;
  const when = document.createElement('time');
  when.dateTime = item.createdAt;
  when.title = new Date(item.createdAt).toLocaleString();
  when.textContent = timeAgo(item.createdAt);
  meta.append(who, when);
  if (item.edited) {
    const edited = document.createElement('span');
    edited.className = 'tag';
    edited.textContent = 'edited';
    meta.append(edited);
  }

  card.append(title, text, meta);
  return card;
}

async function loadMore() {
  if (loading) return;
  loading = true;
  $('moreBtn').disabled = true;
  try {
    const res = await fetch('/api/feedback?page=' + nextPage);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    for (const item of data.items) $('list').append(makeCard(item));
    totalPages = data.pages;
    nextPage = data.page + 1;
    $('count').textContent = data.total + (data.total === 1 ? ' piece of feedback' : ' pieces of feedback');
    $('status').hidden = data.total > 0;
    $('status').className = 'status';
    if (data.total === 0) $('status').textContent = 'No feedback yet. Open the game and tap Feedback to be the first!';
    $('moreBtn').hidden = nextPage > totalPages;
  } catch (e) {
    $('status').hidden = false;
    $('status').className = 'status error';
    $('status').textContent = 'Could not load feedback. Please try again later.';
  } finally {
    loading = false;
    $('moreBtn').disabled = false;
  }
}

async function loadSiteInfo() {
  try {
    const res = await fetch('/api/site');
    const info = await res.json();
    if (info.title) {
      $('siteTitle').textContent = info.title;
      document.title = 'Player Feedback · ' + info.title;
    }
    if (info.gameUrl) {
      $('playLink').href = info.gameUrl;
      $('playLink').hidden = false;
    }
  } catch (e) { /* the page works without it */ }
}

$('moreBtn').addEventListener('click', loadMore);
loadSiteInfo();
loadMore();
