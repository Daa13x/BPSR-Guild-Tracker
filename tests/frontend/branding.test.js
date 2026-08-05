const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the app is branded "OnlyPaws Tracker" with the pink paw favicon and manifest', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  assert.match(html, /<title>OnlyPaws Tracker<\/title>/);
  assert.match(html, /rel="icon"[^>]*type="image\/svg\+xml"[^>]*href="assets\/paw\.svg\?v=[\w.-]+"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="assets\/paw\.svg/);
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
  assert.ok(manifest.icons.some(i => i.src === 'assets/paw.svg'), 'manifest references the paw icon');
});

test('the paw favicon is a transparent two-tone SVG with no background box', () => {
  const svg = fs.readFileSync('assets/paw.svg', 'utf8');
  assert.match(svg, /<svg[^>]*viewBox="0 0 1024 1024"/);
  // Two pink fills (light + dark), no opaque background rect covering the canvas.
  assert.ok(svg.includes('#E389B4') && svg.includes('#C6497F'), 'two-tone pink');
  assert.equal(/<rect[^>]*width="1024"[^>]*height="1024"/.test(svg), false, 'no full-canvas background box');
  assert.equal(/fill="#fff"|fill="white"|fill="#000"|fill="black"/.test(svg), false, 'no black/white box');
});
