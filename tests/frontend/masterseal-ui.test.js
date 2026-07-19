const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function season() {
  return {
    id: 'season-3', displayName: 'Season 3', maxScore: 3650, maxMasterLevel: 20,
    dungeons: [
      { id: 'towering-ruin', number: 1, name: 'Void - Towering Ruin', shortName: 'Towering Ruin' },
      { id: 'tinas-mindrealm', number: 2, name: "Void - Tina's Mindrealm", shortName: "Tina's Mindrealm" },
      { id: 'cursed-radiant-tomb', number: 3, name: 'Cursed Radiant Tomb', shortName: 'Radiant Tomb' },
      { id: 'mech-facility', number: 4, name: 'Mech Facility', shortName: 'Mech Facility' },
      { id: 'mistveil-hunting-ground', number: 5, name: 'Mistveil Hunting Ground', shortName: 'Mistveil' },
      { id: 'sea-ringed-reef', number: 6, name: 'Sea-Ringed Reef', shortName: 'Sea-Ringed Reef' }
    ],
    rewards: [
      { score: 500, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
      { score: 1000, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
      { score: 1500, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
      { score: 2000, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
      { score: 2500, rewardName: 'Avatar Frame', rewardType: 'frame' },
      { score: 3000, rewardName: 'Namecard', rewardType: 'namecard' },
      { score: 3650, rewardName: 'Mount: Neon Sonic', rewardType: 'mount' }
    ]
  };
}

function boardRow(name, overrides) {
  const dungeons = season().dungeons.map(() => ({ bestMasterLevel: 5, points: 316, cleared: true }));
  return {
    name, rank: 1, dungeons, totalScore: 1896, remainingScore: 1754, progressPercent: 51.9,
    clearedCount: 6, mountUnlocked: false, lastUpdated: '2026-07-18T14:32:00.000Z',
    ...(overrides || {})
  };
}

function harness(payload, configured = true) {
  const captured = { html: '', max: '' };
  const sealUi = {
    set innerHTML(value) { captured.html = value; },
    get innerHTML() { return captured.html; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const listeners = [];
  const ctx = {
    window: null,
    document: {
      getElementById: id => (id === 'seal-ui' ? sealUi : id === 'seal-max' ? { set textContent(v) { captured.max = v; }, get textContent() { return captured.max; } } : null),
      addEventListener: (type, listener) => listeners.push([type, listener])
    },
    console, JSON, Promise, Date, Number, String, Math, CSS: { escape: v => v },
    BPSR_CONFIG: { apiUrl: configured ? 'https://script.google.com/macros/' + 's/test/exec' : '', isConfigured: () => configured },
    api: () => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('MasterSeal.js', 'utf8'), ctx);
  listeners.forEach(([type, listener]) => { if (type === 'DOMContentLoaded') listener(); });
  return { captured, ctx, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('the board renders six dungeon cells per member with accessible labels and totals', async () => {
  const data = {
    season: season(),
    board: [
      boardRow('Dax', { rank: 1 }),
      boardRow('Lunara', { rank: 2, totalScore: 900, remainingScore: 2750, progressPercent: 24.7, clearedCount: 3, dungeons: season().dungeons.map((d, i) => i < 3 ? { bestMasterLevel: 4, points: 300, cleared: true } : { bestMasterLevel: null, points: 0, cleared: false }) })
    ],
    generatedAt: '2026-07-19T00:00:00.000Z'
  };
  const app = harness(data);
  await app.settle();
  const html = app.captured.html;
  assert.equal((html.match(/class="seal-cell/g) || []).length, 12, 'two members × six dungeon cells');
  assert.equal((html.match(/Void - Towering Ruin: Master level 5, 316 points/g) || []).length, 1);
  assert.match(html, /Mech Facility: not cleared/);
  assert.match(html, /1,896<\/span> <span class="dim">\/ 3,650/);
  assert.match(app.captured.max, /Maximum score 3,650/);
  assert.match(html, /aria-selected="true"/);
});

test('detail panel shows dungeon artwork paths, reward states and the final mount reward', async () => {
  const data = { season: season(), board: [boardRow('Dax', { totalScore: 2600, remainingScore: 1050, progressPercent: 71.2 })], generatedAt: '' };
  const app = harness(data);
  await app.settle();
  const html = app.captured.html;
  [
    'dungeon-01-void-towering-ruin.webp',
    'dungeon-02-void-tinas-mindrealm.webp',
    'dungeon-03-cursed-radiant-tomb.webp',
    'dungeon-04-mech-facility.webp',
    'dungeon-05-mistveil-hunting-ground.webp',
    'dungeon-06-sea-ringed-reef.webp'
  ].forEach(file => assert.ok(html.includes('assets/master-seal/dungeons/' + file), file + ' referenced'));
  assert.ok(html.includes('assets/master-seal/rewards/reward-mount-neon-sonic.webp'));
  assert.match(html, /Mount: Neon Sonic/);
  assert.equal((html.match(/class="seal-reward earned"/g) || []).length, 5, '500–2,500 earned at 2,600 points');
  assert.equal((html.match(/class="seal-reward current"/g) || []).length, 1, '3,000 is the next milestone');
  assert.equal((html.match(/class="seal-reward locked"/g) || []).length, 1, '3,650 stays locked');
});

test('hostile member names are escaped, never parsed as markup', async () => {
  const data = { season: season(), board: [boardRow('<img src=x onerror=alert(1)>')], generatedAt: '' };
  const app = harness(data);
  await app.settle();
  assert.equal(app.captured.html.includes('<img src=x'), false);
  assert.ok(app.captured.html.includes('&lt;img src=x'));
});

test('empty, unconfigured and error states are explicit', async () => {
  const empty = harness({ season: season(), board: [], generatedAt: '' });
  await empty.settle();
  assert.match(empty.captured.html, /No members yet/);

  const unconfigured = harness({}, false);
  await unconfigured.settle();
  assert.match(unconfigured.captured.html, /connects when the backend API is configured/);

  const failed = harness(new Error('API error'));
  await failed.settle();
  assert.match(failed.captured.html, /Master Seal could not load/);
});
