const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the app is branded "OnlyPaws Tracker" with the pink paw favicon and manifest', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  assert.match(html, /<title>OnlyPaws Tracker<\/title>/);
  assert.match(html, /rel="icon"[^>]*type="image\/png"[^>]*href="assets\/paws\.png\?v=[\w.-]+"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="assets\/paws\.png/);
  assert.match(html, /rel="manifest"[^>]*href="site\.webmanifest/);
  assert.equal(/BPSR Guild Tracker/.test(html), false, 'old title removed from the head');
});

test('the dynamic document title uses the OnlyPaws Tracker brand', () => {
  const page = fs.readFileSync('MasterSealPage.js', 'utf8');
  assert.match(page, /document\.title = 'OnlyPaws Tracker/);
  assert.equal(/BPSR Guild Tracker/.test(page), false, 'no stale brand in the dynamic title');
});

test('index and MasterSeal redirect pages are branded OnlyPaws Tracker', () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /<title>OnlyPaws Tracker<\/title>/);
  assert.match(fs.readFileSync('MasterSeal.html', 'utf8'), /<title>OnlyPaws Tracker/);
});

test('the web manifest names the app OnlyPaws Tracker and uses the paw icon', () => {
  const manifest = JSON.parse(fs.readFileSync('site.webmanifest', 'utf8'));
  assert.equal(manifest.name, 'OnlyPaws Tracker');
  assert.equal(manifest.short_name, 'OnlyPaws');
  assert.ok(manifest.icons.some(i => i.src === 'assets/paws.png'), 'manifest references the paw icon');
});

test('the paw favicon is the real transparent PNG supplied by the user', () => {
  const png = fs.readFileSync('assets/paws.png');
  // Real PNG signature.
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG magic bytes');
  // IHDR is the first chunk; colour type (byte 25) 6 = truecolour with alpha (transparency).
  assert.equal(png.toString('ascii', 12, 16), 'IHDR', 'IHDR first');
  assert.equal(png[25], 6, 'RGBA colour type — carries a transparent background');
  const width = png.readUInt32BE(16);
  assert.ok(width >= 256, 'a real, non-placeholder icon (>=256px square)');
});

test('the admin GitHub Data Storage panel exists and is inside the admin-only renderer', () => {
  const src = fs.readFileSync('AppFrontend.js', 'utf8');
  // The panel and its actions live in renderAdmin (only reached for admins).
  const adminStart = src.indexOf('function renderAdmin');
  const ghStart = src.indexOf("adminCard('GitHub Data Storage'");
  assert.ok(ghStart > adminStart && adminStart !== -1, 'GitHub panel is built inside renderAdmin');
  ['getGithubStorageStatus', 'previewGithubMigration', 'executeGithubMigration', 'verifyGithubMigration', 'switchGithubStorageMode']
    .forEach(a => assert.ok(src.includes("'" + a + "'"), 'panel wires ' + a));
  // github mode switch is guarded by a confirm, and execute needs a preview token.
  assert.match(src, /if \(!lastConfirm\)/);
  assert.match(src, /Switch live storage to GitHub/);
});
