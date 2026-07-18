const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('supplied logo is a non-empty transparent PNG with a text fallback', () => {
  const png = fs.readFileSync('assets/guild-logo.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) > 1000, 'wide source image is preserved rather than stretched/recreated');
  assert.ok(png.readUInt32BE(20) > 200);
  assert.equal(png[25], 6, 'PNG uses RGBA transparency');
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  assert.match(html, /src="assets\/guild-logo\.png" alt="OnlyPaws guild logo"/);
  assert.match(html, /onerror="this\.hidden=true;this\.nextElementSibling\.hidden=false"/);
  assert.match(html, /<span hidden><strong>OnlyPaws<\/strong><small>Guild tracker<\/small><\/span>/);
});

test('application shell has responsive navigation and distinct SV/Masters tab targets', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /class="app-shell"/);
  assert.match(html, /data-board-tab="sv">SV Leaderboard/);
  assert.match(html, /data-board-tab="mp">Masters/);
  assert.match(html, /data-admin-nav hidden/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.app-shell \{ display: block; \}/);
  assert.match(css, /\.sidebar-nav \{ display: flex; gap: 5px; overflow-x: auto;/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});
