'use strict';
// Text limits and cleaning for everything players (or the admin) type.
const { httpError } = require('./http');

// Same numbers the game uses (js/feedback.js in the game).
const LIMITS = { name: 30, title: 80, titleMin: 3, content: 1500, contentMin: 10 };

const BAD_CHARS_SINGLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;       // control, zero-width and "text direction" tricks
const BAD_CHARS_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g; // same, but keeps new lines

// Returns the cleaned text, or throws a 400 error with a friendly message.
function cleanText(value, label, { min = 0, max, multiline = false }) {
  if (typeof value !== 'string') throw httpError(400, label + ' is required.');
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(multiline ? BAD_CHARS_MULTI : BAD_CHARS_SINGLE, '');
  s = multiline ? s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim();
  const length = [...s].length;
  if (length < min) throw httpError(400, label + (min > 1 ? ' must be at least ' + min + ' characters.' : ' is required.'));
  if (length > max) throw httpError(400, label + ' must be at most ' + max + ' characters.');
  return s;
}

module.exports = { LIMITS, cleanText };
