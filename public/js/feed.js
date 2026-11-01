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

// Stars as one element: a grey row of 5 stars with a gold row on top, cut to `value` out of 5 (decimals work: 4.7).
function makeStars(value) {
  const stars = document.createElement('span');
  stars.className = 'stars';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', value + ' out of 5 stars');
  const bg = document.createElement('span');
  bg.className = 'stars-bg';
  bg.textContent = '★★★★★';
  const fg = document.createElement('span');
  fg.className = 'stars-fg';
  fg.textContent = '★★★★★';
  fg.style.width = Math.max(0, Math.min(5, value)) / 5 * 100 + '%';
  stars.append(bg, fg);
  return stars;
}

// 999 -> "999", 1200 -> "1.2K", 121000 -> "121K", 2500000 -> "2.5M"
function shortCount(n) {
  if (n < 1000) return String(n);
  const [value, suffix] = n < 1e6 ? [n / 1000, 'K'] : [n / 1e6, 'M'];
  return (value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)) + suffix;
}

// The rating box: big average, stars, number of ratings and one bar per star level (5 to 1).
function showStats(stats) {
  if (!stats || !stats.count) { $('ratingBox').hidden = true; return; }
  $('ratingBox').hidden = false;
  $('ratingBig').textContent = stats.average.toFixed(1);
  const fg = $('ratingStars').querySelector('.stars-fg');
  fg.style.width = stats.average / 5 * 100 + '%';
  $('ratingStars').setAttribute('aria-label', stats.average.toFixed(1) + ' out of 5 stars');
  $('ratingCount').textContent = shortCount(stats.count) + (stats.count === 1 ? ' rating' : ' ratings');
  const bars = $('ratingBars');
  bars.replaceChildren();
  for (let n = 5; n >= 1; n--) {
    const share = stats.counts[n] / stats.count * 100;
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = n;
    const track = document.createElement('div');
    track.className = 'bar';
    track.title = stats.counts[n] + (stats.counts[n] === 1 ? ' rating' : ' ratings') + ' with ' + n + (n === 1 ? ' star' : ' stars');
    const fill = document.createElement('i');
    fill.style.width = (stats.counts[n] ? Math.max(share, 2) : 0) + '%';        // tiny shares stay visible
    track.append(fill);
    li.append(label, track);
    bars.append(li);
  }
}

// Builds one feedback card.
function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  if (item.rating) card.append(makeStars(item.rating));

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
    showStats(data.stats);
    $('count').textContent = data.total + (data.total === 1 ? ' piece of feedback' : ' pieces of feedback');
    $('status').hidden = data.total > 0;
    $('status').className = 'status';
    if (data.total === 0) $('status').textContent = data.stats && data.stats.count ? 'No written feedback yet.' : 'No feedback yet. Open the game and tap Feedback to be the first!';
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
