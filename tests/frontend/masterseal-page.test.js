const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

/** Load the dashboard controller's pure helpers without a DOM. */
function helpers() {
  const ctx = { console, JSON, Date, Number, String, Math, isFinite, Promise };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('MasterSealPage.js', 'utf8'), ctx);
  return ctx.MS_HELPERS;
}

const H = helpers();
const DAY = 86400000;

function member(over) {
  return {
    id: over.name, name: over.name, rank: over.rank || 1,
    totalScore: over.totalScore || 0,
    remainingScore: H.remainingScore(over.totalScore || 0, 3650),
    progressPercent: H.progressPercent(over.totalScore || 0, 3650),
    clearedCount: over.clearedCount === undefined ? 6 : over.clearedCount,
    mountUnlocked: Boolean(over.mountUnlocked),
    lastUpdated: over.lastUpdated || new Date().toISOString(),
    dungeons: []
  };
}

test('remaining score never drops below zero and handles overshoot', () => {
  assert.equal(H.remainingScore(0, 3650), 3650);
  assert.equal(H.remainingScore(1904, 3650), 1746);
  assert.equal(H.remainingScore(3650, 3650), 0);
  assert.equal(H.remainingScore(4200, 3650), 0, 'scores above the maximum clamp at zero');
});

test('progress percentage clamps at 100 and survives a zero maximum', () => {
  assert.equal(H.progressPercent(0, 3650), 0);
  assert.equal(Math.round(H.progressPercent(1904, 3650)), 52);
  assert.equal(H.progressPercent(3650, 3650), 100);
  assert.equal(H.progressPercent(9999, 3650), 100, 'overshoot clamps at 100');
  assert.equal(H.progressPercent(500, 0), 0, 'a zero maximum must not divide by zero');
});

test('cleared count reflects the six dungeon records', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ cleared: i < 4 }));
  assert.equal(H.clearedCount(six), 4);
  assert.equal(H.clearedCount([]), 0);
  assert.equal(H.clearedCount(null), 0);
});

test('reward milestones resolve to done, next and locked in order', () => {
  const thresholds = [500, 1000, 1500, 2000, 2500, 3000, 3650];
  const states = thresholds.map((score, i) => H.milestoneState(score, 2600, i === 0 ? 0 : thresholds[i - 1]));
  assert.deepEqual(states, ['done', 'done', 'done', 'done', 'done', 'next', 'locked']);
  assert.equal(H.milestoneState(3650, 3650, 3000), 'done', 'the mount unlocks at exactly the maximum');
  assert.equal(H.milestoneState(500, 0, 0), 'next', 'the first milestone is next at zero score');
});

test('reward markers are positioned by threshold share, not evenly spaced', () => {
  assert.equal(H.markerOffset(3650, 3650), 100);
  assert.equal(Math.round(H.markerOffset(500, 3650)), 14);
  assert.equal(Math.round(H.markerOffset(1825, 3650)), 50);
  assert.equal(H.markerOffset(500, 0), 0);
  assert.notEqual(Math.round(H.markerOffset(1000, 3650)), Math.round(100 / 7 * 2), 'positions follow score, not index');
});

test('recent activity and staleness use real timestamps', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');
  assert.equal(H.recentlyActive(new Date(now - 3600000).toISOString(), now), true);
  assert.equal(H.recentlyActive(new Date(now - 3 * DAY).toISOString(), now), false);
  assert.equal(H.recentlyActive(null, now), false);
  assert.equal(H.isStale(new Date(now - 20 * DAY).toISOString(), now), true);
  assert.equal(H.isStale(new Date(now - 2 * DAY).toISOString(), now), false);
  assert.equal(H.isStale(null, now), true, 'never-updated members count as stale');
});

test('search matches character names case-insensitively', () => {
  const members = [member({ name: 'Dax', rank: 1 }), member({ name: 'Lunara', rank: 2 }), member({ name: 'Raven', rank: 3 })];
  assert.deepEqual(H.selectMembers(members, { query: 'lun' }).map(m => m.name), ['Lunara']);
  assert.deepEqual(H.selectMembers(members, { query: 'RAVEN' }).map(m => m.name), ['Raven']);
  assert.deepEqual(H.selectMembers(members, { query: 'zzz' }).map(m => m.name), []);
  assert.equal(H.selectMembers(members, { query: '  ' }).length, 3, 'blank search returns everyone');
});

test('sorting reorders by every supported key', () => {
  const members = [
    member({ name: 'Dax', rank: 1, totalScore: 1904, lastUpdated: '2026-07-20T10:00:00Z' }),
    member({ name: 'Aria', rank: 2, totalScore: 900, lastUpdated: '2026-07-28T10:00:00Z' }),
    member({ name: 'Zephyr', rank: 3, totalScore: 1500, lastUpdated: '2026-07-10T10:00:00Z' })
  ];
  assert.deepEqual(H.selectMembers(members, { sort: 'rank' }).map(m => m.name), ['Dax', 'Aria', 'Zephyr']);
  assert.deepEqual(H.selectMembers(members, { sort: 'total' }).map(m => m.name), ['Dax', 'Zephyr', 'Aria']);
  assert.deepEqual(H.selectMembers(members, { sort: 'remaining' }).map(m => m.name), ['Dax', 'Zephyr', 'Aria']);
  assert.deepEqual(H.selectMembers(members, { sort: 'name' }).map(m => m.name), ['Aria', 'Dax', 'Zephyr']);
  assert.deepEqual(H.selectMembers(members, { sort: 'updated' }).map(m => m.name), ['Aria', 'Dax', 'Zephyr']);
  assert.deepEqual(H.selectMembers(members, { sort: 'progress' }).map(m => m.name), ['Dax', 'Zephyr', 'Aria']);
});

test('filters work, including together with search', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');
  const members = [
    member({ name: 'Dax', rank: 1, totalScore: 3650, mountUnlocked: true, clearedCount: 6, lastUpdated: new Date(now - 3600000).toISOString() }),
    member({ name: 'Daria', rank: 2, totalScore: 900, mountUnlocked: false, clearedCount: 3, lastUpdated: new Date(now - 30 * DAY).toISOString() }),
    member({ name: 'Nyx', rank: 3, totalScore: 0, mountUnlocked: false, clearedCount: 0, lastUpdated: new Date(now - 2 * DAY).toISOString() })
  ];
  const pick = options => H.selectMembers(members, Object.assign({ now }, options)).map(m => m.name);
  assert.deepEqual(pick({ filter: 'mount' }), ['Dax']);
  assert.deepEqual(pick({ filter: 'locked' }), ['Daria', 'Nyx']);
  assert.deepEqual(pick({ filter: 'six' }), ['Dax']);
  assert.deepEqual(pick({ filter: 'incomplete' }), ['Daria', 'Nyx']);
  assert.deepEqual(pick({ filter: 'online' }), ['Dax']);
  assert.deepEqual(pick({ filter: 'offline' }), ['Daria', 'Nyx']);
  assert.deepEqual(pick({ advStale: true }), ['Daria']);
  assert.deepEqual(pick({ advZero: true }), ['Nyx']);
  // search + filter compose
  assert.deepEqual(pick({ query: 'da', filter: 'locked' }), ['Daria']);
  assert.deepEqual(pick({ query: 'da', filter: 'mount' }), ['Dax']);
});

test('pagination slices correctly and clamps out-of-range pages', () => {
  const list = Array.from({ length: 28 }, (_, i) => ({ n: i + 1 }));
  const first = H.pageSlice(list, 1, 10);
  assert.equal(first.rows.length, 10);
  assert.equal(first.pages, 3);
  assert.equal(first.start, 0);
  const last = H.pageSlice(list, 3, 10);
  assert.equal(last.rows.length, 8);
  assert.equal(last.rows[0].n, 21);
  const beyond = H.pageSlice(list, 99, 10);
  assert.equal(beyond.page, 3, 'a page past the end clamps to the last page');
  const empty = H.pageSlice([], 1, 10);
  assert.equal(empty.pages, 1);
  assert.equal(empty.rows.length, 0);
});

test('season countdown derives from the configured end date', () => {
  const now = Date.parse('2026-07-19T00:00:00Z');
  const parts = H.countdownParts('2026-08-22T12:48:00Z', now);
  assert.equal(parts.ended, false);
  assert.equal(parts.days, 34);
  assert.equal(parts.hours, 12);
  assert.equal(parts.minutes, 48);
  assert.equal(H.formatCountdown(parts), '34d 12h 48m');
  assert.equal(H.formatCountdown(H.countdownParts('2026-01-01T00:00:00Z', now)).includes('ended'), true);
  assert.match(H.formatCountdown(H.countdownParts('not-a-date', now)), /not configured/);
});

test('an empty board yields no rows and no selection candidates', () => {
  assert.equal(H.selectMembers([], { query: 'anything' }).length, 0);
  assert.equal(H.selectMembers(null, {}).length, 0, 'missing data must not throw');
  assert.equal(H.pageSlice(H.selectMembers(null, {}), 1, 10).rows.length, 0);
});
