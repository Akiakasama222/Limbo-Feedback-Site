'use strict';
// Simple rate limiting kept in the memory of the running function instance.
//
// Honest limits: Vercel may run several instances at once and restarts them from time to time, so these counters are
// "best effort" (they stop quick repeated clicks and simple scripts). For stronger protection add a rate-limit rule in
// Vercel's Firewall (Project > Firewall) and / or use REQUIRE_APPROVAL=1 so nothing is published without your OK.
const buckets = new Map();      // name -> { count, expires }

function live(name) {
  const b = buckets.get(name);
  if (b && b.expires <= Date.now()) { buckets.delete(name); return null; }
  return b || null;
}

// How many times `name` was counted in the current window.
function rateCount(name) {
  const b = live(name);
  return b ? b.count : 0;
}

// Counts one more hit; the window starts at the first hit and lasts `windowSeconds`.
function rateAdd(name, windowSeconds) {
  if (buckets.size > 5000) for (const key of [...buckets.keys()]) live(key);     // clean up old entries
  const b = live(name) || { count: 0, expires: Date.now() + windowSeconds * 1000 };
  b.count++;
  buckets.set(name, b);
  return b.count;
}

function rateReset(name) {
  buckets.delete(name);
}

module.exports = { rateCount, rateAdd, rateReset };
