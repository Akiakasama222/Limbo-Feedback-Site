'use strict';
// The same API tests run against every storage setup (memory.test.js, sheets-direct.test.js, sheets-make.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');

function registerTests(getBase) {
  const J = { 'Content-Type': 'application/json' };
  const X = { 'X-Requested-With': 'fetch' };
  let ipCounter = 0;
  const newIp = () => '10.0.' + Math.floor(++ipCounter / 250) + '.' + (ipCounter % 250);   // each test gets its own "visitor"

  const call = (method, path, { body, headers, cookie, ip } = {}) => fetch(getBase() + path, {
    method,
    headers: { ...(body !== undefined ? J : {}), ...(ip ? { 'x-real-ip': ip } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const post = (body, ip) => call('POST', '/api/feedback', { body, ip: ip || newIp() });
  const good = (over = {}) => ({ anonymous: true, title: 'Nice game', content: 'I really like the Swirl sword.', ...over });

  async function login() {
    const res = await call('POST', '/api/admin/login', { body: { password: 'test-pass-123' }, headers: X, ip: newIp() });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  const admin = (method, path, cookie, body) => call(method, path, { cookie, headers: X, body });

  test('public: add anonymous + named feedback and list them (newest first)', async () => {
    let res = await post(good({ title: 'First one' }));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, pending: false });
    await new Promise(r => setTimeout(r, 5));
    res = await post(good({ anonymous: false, name: '  Alex   P  ', title: 'Second one' }));
    assert.equal(res.status, 201);
    const list = await (await call('GET', '/api/feedback')).json();
    assert.equal(list.total, 2);
    assert.deepEqual(list.items.map(i => i.title), ['Second one', 'First one']);
    assert.equal(list.items[0].name, 'Alex P');
    assert.equal(list.items[1].name, 'Anonymous');
    assert.ok(!('hidden' in list.items[0]), 'public items do not expose admin fields');
  });

  test('public: validation errors', async () => {
    const cases = [
      [good({ title: 'ab' }), /at least 3/], [good({ content: 'short' }), /at least 10/], [good({ content: 'x'.repeat(1501) }), /at most 1500/],
      [good({ title: 'x'.repeat(81) }), /at most 80/], [good({ anonymous: false, name: '   ' }), /Name/], [good({ anonymous: false, name: 'n'.repeat(31) }), /at most 30/],
      [{ anonymous: true }, /title/i], [good({ title: 5 }), /Title/]
    ];
    for (const [body, pattern] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.match((await res.json()).error, pattern);
    }
    assert.equal((await call('POST', '/api/feedback', { body: 'x', headers: { 'Content-Type': 'text/plain' }, ip: newIp() })).status, 415);
    assert.equal((await call('POST', '/api/feedback', { body: '{bad', headers: J, ip: newIp() })).status, 400);
    assert.equal((await call('POST', '/api/feedback', { body: '[1,2]', headers: J, ip: newIp() })).status, 400);
    assert.equal((await call('POST', '/api/feedback', { body: JSON.stringify({ title: 'abc', content: 'y'.repeat(20000) }), headers: J, ip: newIp() })).status, 413);
    assert.equal((await call('DELETE', '/api/feedback')).status, 405);
  });

  test('public: HTML / control characters are stored as plain text and cleaned', async () => {
    const res = await post(good({ title: '<img src=x onerror=alert(1)>', content: '<script>alert(1)</script>\u202E hidden\u0000 chars\n\n\n\n\nend' }));
    assert.equal(res.status, 201);
    const item = (await (await call('GET', '/api/feedback')).json()).items.find(i => i.title.startsWith('<img'));
    assert.ok(item, 'saved as text');
    assert.ok(!/[\u202E\u0000]/.test(item.content));
    assert.ok(!/\n\n\n/.test(item.content));
  });

  test('public: rate limit per visitor (5 per 10 minutes), other visitors unaffected', async () => {
    const ip = newIp();
    for (let i = 0; i < 5; i++) assert.equal((await post(good({ title: 'Spam ' + i }), ip)).status, 201);
    const blocked = await post(good(), ip);
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /try again/);
    assert.equal((await post(good(), newIp())).status, 201);
  });

  test('public: CORS for the game, none for admin', async () => {
    let res = await call('OPTIONS', '/api/feedback', { headers: { Origin: 'https://game.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    res = await call('POST', '/api/feedback', { body: good(), headers: { Origin: 'https://game.example' }, ip: newIp() });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    res = await call('OPTIONS', '/api/admin/feedback', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal((await call('GET', '/api/admin/feedback', { headers: { Origin: 'https://evil.example', ...X } })).headers.get('access-control-allow-origin'), null);
  });

  test('admin: needs login, header and valid cookie', async () => {
    assert.equal((await call('GET', '/api/admin/feedback')).status, 400);                                  // missing X-Requested-With
    assert.equal((await call('GET', '/api/admin/feedback', { headers: X })).status, 401);                  // no cookie
    assert.equal((await call('GET', '/api/admin/feedback', { headers: X, cookie: 'es_admin=9999999999999.AAAA' })).status, 401);   // forged
    const wrong = await call('POST', '/api/admin/login', { body: { password: 'nope' }, headers: X, ip: newIp() });
    assert.equal(wrong.status, 401);
    const ok = await call('POST', '/api/admin/login', { body: { password: 'test-pass-123' }, headers: X, ip: newIp() });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api\/admin/);
    assert.equal((await admin('GET', '/api/admin/me', cookie.split(';')[0])).status, 200);
  });

  test('admin: five wrong passwords lock the visitor out', async () => {
    const ip = newIp();
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/admin/login', { body: { password: 'bad' + i }, headers: X, ip })).status, 401);
    const res = await call('POST', '/api/admin/login', { body: { password: 'test-pass-123' }, headers: X, ip });
    assert.equal(res.status, 429);
  });

  test('admin: edit, hide / show, delete', async () => {
    const cookie = await login();
    await post(good({ anonymous: false, name: 'Mallory', title: 'Rude title', content: 'Something not very nice here.' }));
    let all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    const target = all.items.find(i => i.title === 'Rude title');
    assert.ok(target);
    // edit
    let res = await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { title: 'Polite title', name: '' });
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.equal(data.item.title, 'Polite title'); assert.equal(data.item.anonymous, true); assert.equal(data.item.edited, true);
    // public shows edited + anonymous
    let pub = (await (await call('GET', '/api/feedback')).json()).items.find(i => i.id === target.id);
    assert.equal(pub.name, 'Anonymous'); assert.equal(pub.edited, true);
    // hide
    const before = (await (await call('GET', '/api/feedback')).json()).total;
    res = await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { hidden: true });
    assert.equal((await res.json()).counts.hidden >= 1, true);
    pub = await (await call('GET', '/api/feedback')).json();
    assert.equal(pub.total, before - 1); assert.ok(!pub.items.some(i => i.id === target.id));
    all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    assert.equal(all.items.find(i => i.id === target.id).hidden, true);
    // show again
    await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { hidden: false });
    assert.equal((await (await call('GET', '/api/feedback')).json()).total, before);
    // bad edits
    assert.equal((await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { hidden: 'yes' })).status, 400);
    assert.equal((await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { title: 'x' })).status, 400);
    assert.equal((await admin('PATCH', '/api/admin/feedback/f00000000000', cookie, { hidden: true })).status, 404);
    assert.equal((await admin('PATCH', '/api/admin/feedback/not-an-id', cookie, { hidden: true })).status, 404);
    // delete
    res = await admin('DELETE', '/api/admin/feedback/' + target.id, cookie);
    assert.equal(res.status, 200);
    all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    assert.ok(!all.items.some(i => i.id === target.id));
    assert.equal((await admin('DELETE', '/api/admin/feedback/' + target.id, cookie)).status, 404);
  });

  test('public: pagination (20 per page)', async () => {
    const before = (await (await call('GET', '/api/feedback')).json()).total;
    for (let i = 0; i < 25; i++) assert.equal((await post(good({ title: 'Bulk ' + i }), '172.16.' + Math.floor(i / 4) + '.' + (i % 4))).status, 201);
    const p1 = await (await call('GET', '/api/feedback?page=1')).json();
    const p2 = await (await call('GET', '/api/feedback?page=2')).json();
    assert.equal(p1.items.length, 20); assert.equal(p1.total, before + 25); assert.equal(p1.pages, Math.ceil((before + 25) / 20));
    assert.equal(p2.page, 2); assert.ok(p2.items.length >= 1);
    const ids = new Set([...p1.items, ...p2.items].map(i => i.id));
    assert.equal(ids.size, p1.items.length + p2.items.length, 'no duplicates between pages');
    const far = await (await call('GET', '/api/feedback?page=999')).json();
    assert.equal(far.page, far.pages);
  });

  const stats = async () => (await (await call('GET', '/api/feedback')).json()).stats;

  test('rating: validation (whole number 1-5; an empty message needs a rating)', async () => {
    for (const bad of [0, 6, 3.5, -1, '5', 'five', true]) {
      const res = await post(good({ rating: bad }));
      assert.equal(res.status, 400, 'rating ' + JSON.stringify(bad));
      assert.match((await res.json()).error, /1 to 5 stars/);
    }
    const none = await post({ anonymous: true });                                       // no text, no rating
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /title and a message, or choose a star rating/);
    assert.equal((await post({ anonymous: true, title: '   ', content: ' ', rating: 4 })).status, 201);   // blanks count as "no comment"
    const half = await post({ anonymous: true, title: 'Only a title', rating: 4 });      // a comment needs title AND message
    assert.equal(half.status, 400);
    assert.match((await half.json()).error, /Feedback is required|at least 10/);
  });

  test('rating: stars on a comment show on the card and count in the statistics', async () => {
    const before = await stats();
    const res = await post(good({ title: 'Five stars from me', rating: 5 }));
    assert.equal(res.status, 201);
    const list = await (await call('GET', '/api/feedback')).json();
    assert.equal(list.items.find(i => i.title === 'Five stars from me').rating, 5);
    assert.equal(list.stats.count, before.count + 1);
    assert.equal(list.stats.counts[5], before.counts[5] + 1);
  });

  test('rating: a stars-only entry counts in the statistics but is not listed as a card', async () => {
    const before = await stats();
    const listBefore = await (await call('GET', '/api/feedback')).json();
    assert.equal((await post({ anonymous: true, rating: 2 })).status, 201);
    const after = await (await call('GET', '/api/feedback')).json();
    assert.equal(after.stats.count, before.count + 1);
    assert.equal(after.stats.counts[2], before.counts[2] + 1);
    assert.equal(after.total, listBefore.total, 'no new card');
    // the admin does see it
    const cookie = await login();
    const all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    const entry = all.items.find(i => i.rating === 2 && i.title === '' && i.content === '');
    assert.ok(entry, 'rating-only entry visible to the admin');
    assert.equal(entry.anonymous, true);
  });

  test('rating: average and distribution are consistent; hidden or deleted ratings are left out', async () => {
    const cookie = await login();
    const s0 = await stats();
    const ip = newIp();
    await post({ anonymous: true, rating: 1 }, ip);
    await post({ anonymous: true, rating: 4 }, ip);
    const s1 = await stats();
    assert.equal(s1.count, s0.count + 2);
    const sum = [1, 2, 3, 4, 5].reduce((t, n) => t + n * s1.counts[n], 0);
    assert.equal(s1.average, Math.round(sum / s1.count * 100) / 100);
    assert.equal(Object.values(s1.counts).reduce((a, b) => a + b, 0), s1.count);
    // hide one of them -> not counted; show again -> counted; delete -> gone
    const all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    const target = all.items.find(i => i.rating === 1 && !i.title);
    await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { hidden: true });
    assert.equal((await stats()).counts[1], s1.counts[1] - 1);
    await admin('PATCH', '/api/admin/feedback/' + target.id, cookie, { hidden: false });
    assert.equal((await stats()).counts[1], s1.counts[1]);
    await admin('DELETE', '/api/admin/feedback/' + target.id, cookie);
    assert.equal((await stats()).counts[1], s1.counts[1] - 1);
  });

  test('rating: the admin can edit around a stars-only entry but cannot give it half a comment', async () => {
    const cookie = await login();
    await post({ anonymous: true, rating: 3 });
    const all = await (await admin('GET', '/api/admin/feedback', cookie)).json();
    const entry = all.items.find(i => i.rating === 3 && !i.title);
    assert.equal((await admin('PATCH', '/api/admin/feedback/' + entry.id, cookie, { name: 'Zed' })).status, 200);
    assert.equal((await admin('PATCH', '/api/admin/feedback/' + entry.id, cookie, { title: '', content: '' })).status, 200);
    assert.equal((await admin('PATCH', '/api/admin/feedback/' + entry.id, cookie, { title: 'Only a title' })).status, 400);
  });

  test('site info', async () => {
    const info = await (await call('GET', '/api/site')).json();
    assert.equal(info.title, 'Limbo');
  });
}

module.exports = { registerTests };
