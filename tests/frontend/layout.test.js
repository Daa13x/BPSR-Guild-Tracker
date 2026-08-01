const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('supplied OnlyPaws logo is a non-empty transparent PNG shown in the sidebar with a text fallback', () => {
  const png = fs.readFileSync('assets/guild-logo.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) > 1000, 'wide source image is preserved rather than stretched/recreated');
  assert.ok(png.readUInt32BE(20) > 200);
  assert.equal(png[25], 6, 'PNG uses RGBA transparency');
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const css = fs.readFileSync('master-seal.css', 'utf8');
  // The brand in the top-left corner is the supplied logo, not a generic mark.
  assert.match(html, /class="ms-brand-logo" src="assets\/guild-logo\.png" alt="OnlyPaws guild logo"/);
  assert.match(html, /onerror="this\.hidden=true;this\.nextElementSibling\.hidden=false"/);
  assert.match(html, /<span class="ms-brand-text" hidden><strong>OnlyPaws<\/strong><small>Guild Tracker<\/small><\/span>/);
  assert.match(css, /\.ms-brand-logo \{[^}]*object-fit: contain/);
});

test('one dashboard page hosts Master Seal and two separate leaderboards in the same shell', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  // Dashboard shell, not the old app-shell.
  assert.match(html, /<body class="ms-body">/);
  assert.match(html, /<div class="ms-shell">/);
  assert.match(html, /<aside class="ms-sidebar" id="ms-sidebar"/);
  assert.match(html, /<main class="ms-main" id="ms-main">/);
  assert.match(html, /<aside class="ms-detail" id="ms-detail"/);
  // Master Seal region.
  assert.match(html, /id="master-seal"/);
  assert.match(html, /id="ms-table-host"/);
  assert.match(html, /id="ms-pages"/);
  assert.match(html, /id="ms-season-note-value"/);
  // SV and Masters are two independent sections, each with its own podium,
  // search, filter chips and table — not one tabbed board.
  assert.match(html, /id="sv-board"/);
  assert.match(html, /id="masters-board"/);
  ['podium-sv', 'podium-mp', 'board-sv', 'board-mp', 'search-sv', 'search-mp', 'count-sv', 'count-mp']
    .forEach(id => assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`));
  assert.ok(html.indexOf('id="sv-board"') < html.indexOf('id="masters-board"'), 'SV leads, Masters follows');
  assert.equal(/data-tab="mc"/.test(html), false, 'Master Completion tab removed');
  assert.equal(/data-tab="hall"/.test(html), false, 'Mount Hall of Fame tab removed');
  assert.equal(/class="tabs"/.test(html), false, 'boards are separate sections, not tabs');
  // Sidebar: no Overview group, no redundant Master Seal entry.
  assert.equal(/>Overview</.test(html), false, 'Overview nav group removed');
  assert.equal(/ms-nav-item[^>]*>[\s\S]{0,80}Master Seal</.test(html), false, 'Master Seal nav entry removed');
  // Member area, admin and the account gate all live here too.
  ['my-progress', 'administration', 'member-ui', 'admin-ui']
    .forEach(id => assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`));
  assert.match(html, /<div class="gate" id="gate" hidden><\/div>/);
  assert.match(html, /data-admin-nav hidden/);
  // Scripts are shared and versioned.
  assert.match(html, /<script src="Boards\.js\?v=[\w.-]+"><\/script>/);
  assert.match(html, /<script src="MasterSealPage\.js\?v=[\w.-]+"><\/script>/);
  assert.match(html, /<script src="AppFrontend\.js\?v=[\w.-]+"><\/script>/);
  assert.equal(/<script>[\s\S]*?<\/script>/.test(html.replace(/<script src=[^>]*><\/script>/g, '')), false,
    'board logic lives in Boards.js, not inline');
});

test('Analytics and the guild settings card are gone from markup, script and stylesheet', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const boards = fs.readFileSync('Boards.js', 'utf8');
  const frontend = fs.readFileSync('AppFrontend.js', 'utf8');
  const css = fs.readFileSync('master-seal.css', 'utf8');
  // No Analytics group, no Achievements or Activity Feed section anywhere.
  [/>Analytics</, /id="achievements"/, /id="feed-panel"/, /id="firsts"/, /id="feed"/, /Activity Feed/]
    .forEach(pattern => assert.equal(pattern.test(html), false, `${pattern} still in the page`));
  // No guild information/settings card.
  [/Your Guild/, /ms-guild-card/, /ms-guild-name/, /ms-guild-xp/]
    .forEach(pattern => assert.equal(pattern.test(html), false, `${pattern} still in the page`));
  // The render functions and state behind them are deleted, not hidden.
  [/renderFirsts/, /renderFeed/, /firstLabel/, /fmtRelative/, /hallOfFame/, /mcBoard/]
    .forEach(pattern => assert.equal(pattern.test(boards), false, `${pattern} still in Boards.js`));
  assert.equal(/getElementById\('firsts'\)/.test(frontend), false, 'no reference to the deleted #firsts');
  // Dead CSS for those sections is removed too.
  [/\.firsts \{/, /\.first-card \{/, /\.feed \{/, /\.ms-guild-card \{/, /\.ms-xp \{/]
    .forEach(pattern => assert.equal(pattern.test(css), false, `${pattern} still in master-seal.css`));
});

test('SV and Masters are laid out as one even pair', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const css = fs.readFileSync('master-seal.css', 'utf8');
  const section = id => {
    const at = html.indexOf(`id="${id}"`);
    return html.slice(html.lastIndexOf('<section', at), html.indexOf('</section>', at));
  };
  const sv = section('sv-board');
  const mp = section('masters-board');
  // Same wrapper classes, same building blocks, same order.
  [sv, mp].forEach(part => {
    ['ms-panel ms-section ms-board-section', 'ms-section-head', 'ms-section-title', 'ms-section-sub',
      'ms-count-badge', 'class="podium"', 'class="controls"', 'class="search"', 'class="chips"', 'class="tablewrap"']
      .forEach(token => assert.ok(part.includes(token), `board section missing ${token}`));
  });
  assert.equal((sv.match(/class="chip/g) || []).length, (mp.match(/class="chip/g) || []).length,
    'both boards expose the same number of filter chips');
  // Shared geometry rather than per-board overrides.
  assert.match(css, /\.ms-board-section \{ display: grid;/);
  assert.match(css, /\.banner \{[\s\S]*?min-height: 132px;/);
  assert.match(css, /\.board-state \{[\s\S]*?min-height: 132px;/);
});

test('Season 3 is presented as scheduled-through, never as a confirmed end date', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const config = fs.readFileSync('config.js', 'utf8');
  const seal = fs.readFileSync('MasterSeal.gs', 'utf8');
  assert.match(html, /has not been formally announced/);
  assert.match(html, /extends through\s+19 August 2026/);
  assert.match(html, /Echoes of Ember/);
  assert.equal(/ends in/i.test(html), false, 'no countdown to an unannounced end date');
  assert.match(config, /scheduleThrough: '19 August 2026'/);
  assert.match(config, /endDateAnnounced: false/);
  // The backend no longer asserts an end date either.
  assert.match(seal, /endsAt: null/);
  assert.match(seal, /scheduleThrough: '19 August 2026'/);
  assert.equal(/2026-08-22/.test(seal), false, 'the stale 22 August date is gone');
});

test('navigation lists only working destinations and obsolete hashes fall back to SV', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const boards = fs.readFileSync('Boards.js', 'utf8');
  const navHrefs = [...html.matchAll(/class="ms-nav-item[^"]*" href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(navHrefs, ['#sv-board', '#masters-board', '#my-progress', '#administration']);
  // Every navigable target is a section that actually exists on the page.
  navHrefs.forEach(href => assert.match(html, new RegExp(`id="${href.slice(1)}"`), `${href} has no section`));
  assert.match(boards, /SUPPORTED_HASHES/);
  assert.match(boards, /FALLBACK_HASH = '#sv-board'/);
  assert.equal(/#achievements|#feed-panel/.test(boards), false, 'no routing case for deleted sections');
});

test('no shipped frontend file can render a vague or stale backend message', () => {
  const shipped = ['Leaderboard.html', 'config.js', 'Boards.js', 'MasterSealPage.js', 'AppFrontend.js'];
  const banned = [
    /'API error'/, /"API error"/, />API error</,
    /not live on the backend/,
    /still needs the updated/,
    /AuthApi\.gs and MasterSeal\.gs/
  ];
  // Comments may name these labels to explain why they are forbidden; only
  // what the page can actually render is checked.
  const withoutComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  shipped.forEach(file => {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    banned.forEach(pattern =>
      assert.equal(pattern.test(source), false, `${file} still contains ${pattern}`));
  });
  // The dead pre-dashboard board script is gone, not left behind to resurface.
  assert.equal(fs.existsSync('MasterSeal.js'), false, 'superseded MasterSeal.js must not return');
});

test('static assets share one cache token so a change cannot be served stale', () => {
  const html = fs.readFileSync('Leaderboard.html', 'utf8');
  const tokens = [...html.matchAll(/(?:src|href)="[\w.-]+\.(?:js|css)\?v=([\w.-]+)"/g)].map(m => m[1]);
  assert.equal(tokens.length, 6, 'every script and stylesheet carries a cache token');
  assert.equal(new Set(tokens).size, 1, 'all assets share one token');
  assert.ok(Number(tokens[0]) >= 7, 'token was bumped past the previously published build');
});

test('the old Master Seal URL redirects into the single dashboard', () => {
  const html = fs.readFileSync('MasterSeal.html', 'utf8');
  assert.match(html, /location\.replace/);
  assert.match(html, /Leaderboard\.html/);
  assert.match(html, /http-equiv="refresh"/);
});

test('dashboard shell uses the template display font and the reference three-column composition', () => {
  const css = fs.readFileSync('master-seal.css', 'utf8');
  assert.match(css, /grid-template-columns:\s*205px minmax\(680px, 1fr\) minmax\(430px, 550px\)/);
  assert.match(css, /font-family: 'Philosopher'/);
  assert.match(css, /assets\/fonts\/Philosopher-Bold\.woff/);
  for (const font of ['Philosopher-Bold', 'Philosopher-Regular']) {
    const file = fs.readFileSync(`assets/fonts/${font}.woff`);
    assert.ok(file.length > 10000, `${font} is a real font file`);
    assert.equal(file.subarray(0, 4).toString('ascii'), 'wOFF', `${font} is WOFF`);
  }
  // Responsive: detail drops below on medium, cards and a drawer on mobile.
  assert.match(css, /@media \(max-width: 1250px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.ms-sidebar \{ display: none;/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.ms-table, \.ms-table tbody, \.ms-table tr, \.ms-table td \{ display: block; \}/);
  // The in-page seal panel must not break out of the page column.
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.equal(/\.seal-panel \{ margin-left: calc/.test(styles), false, 'no full-bleed break-out');
});

test('production dungeon and reward art ships with the dashboard', () => {
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
