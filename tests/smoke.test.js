const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('baseline and JSON API are present', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'AuthApi.gs'), 'utf8');
  assert.match(code, /function buildBundle_/);
  assert.match(code, /function submitProgress/);
  assert.match(auth, /function doPost/);
  assert.match(auth, /function registerMember_/);
  assert.match(auth, /function session_/);
});

test('public frontend has safe escaping and no embedded deployment URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'Leaderboard.html'), 'utf8');
  assert.match(html, /function esc\(s\)/);
  assert.doesNotMatch(html, /script\.google\.com\/macros\/s\//);
});
