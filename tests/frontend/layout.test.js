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

test('Master Seal section, gate host, versioned scripts and production assets are wired', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /<section class="panel seal-panel" id="master-seal"/);
  assert.match(html, /id="seal-ui"/);
  assert.match(html, /href="MasterSeal\.html">Master Seal</);
  assert.match(html, /class="seal-open-dashboard" href="MasterSeal\.html"/);
  assert.match(html, /<div class="gate" id="gate" hidden><\/div>/);
  assert.match(html, /<script src="MasterSeal\.js\?v=[\w.-]+"><\/script>/);
  assert.match(css, /\.seal-table th \{\s*position: sticky/);
  assert.match(css, /\.gate \{/);
  assert.match(css, /\.seal-table td\.seal-cell \{ display: inline-grid; width: calc\(\(100% - 16px\) \/ 3\);/, 'mobile 2×3-style dungeon grid');
  const dungeonFiles = [
    'dungeon-01-void-towering-ruin', 'dungeon-02-void-tinas-mindrealm', 'dungeon-03-cursed-radiant-tomb',
    'dungeon-04-mech-facility', 'dungeon-05-mistveil-hunting-ground', 'dungeon-06-sea-ringed-reef'
  ];
  dungeonFiles.forEach(name => {
    const file = fs.readFileSync(`assets/master-seal/dungeons/${name}.webp`);
    assert.ok(file.length > 1000, `${name} is a real image`);
    assert.equal(file.subarray(0, 4).toString('ascii'), 'RIFF', `${name} is WebP`);
  });
  ['reward-rose-orb', 'reward-avatar-frame', 'reward-namecard', 'reward-mount-neon-sonic'].forEach(name => {
    const file = fs.readFileSync(`assets/master-seal/rewards/${name}.webp`);
    assert.ok(file.length > 1000, `${name} is a real image`);
  });
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

test('Master Seal dashboard page is wired with versioned assets and the template display font', () => {
  const html = fs.readFileSync('MasterSeal.html', 'utf8');
  const css = fs.readFileSync('master-seal.css', 'utf8');
  assert.match(html, /<link rel="stylesheet" href="master-seal\.css\?v=[\w.-]+">/);
  assert.match(html, /<script src="MasterSealPage\.js\?v=[\w.-]+"><\/script>/);
  assert.match(html, /id="ms-sidebar"/);
  assert.match(html, /id="ms-table-host"/);
  assert.match(html, /id="ms-detail"/);
  assert.match(html, /id="ms-countdown-value"/);
  assert.match(html, /id="ms-pages"/);
  // Three-column dashboard grid per the reference composition.
  assert.match(css, /grid-template-columns:\s*205px minmax\(680px, 1fr\) minmax\(430px, 550px\)/);
  // Philosopher display face supplied by the game website template.
  assert.match(css, /font-family: 'Philosopher'/);
  assert.match(css, /assets\/fonts\/Philosopher-Bold\.woff/);
  for (const font of ['Philosopher-Bold', 'Philosopher-Regular']) {
    const file = fs.readFileSync(`assets/fonts/${font}.woff`);
    assert.ok(file.length > 10000, `${font} is a real font file`);
    assert.equal(file.subarray(0, 4).toString('ascii'), 'wOFF', `${font} is WOFF`);
  }
  // Mobile must become cards, never a shrunken desktop table.
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.ms-table, \.ms-table tbody, \.ms-table tr, \.ms-table td \{ display: block; \}/);
});
