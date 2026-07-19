const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

const SIX = {
  'towering-ruin': { bestMasterLevel: 5, points: 316, cleared: true },
  'tinas-mindrealm': { bestMasterLevel: 5, points: 310, cleared: true },
  'cursed-radiant-tomb': { bestMasterLevel: 6, points: 330, cleared: true },
  'mech-facility': { bestMasterLevel: 5, points: 316, cleared: true },
  'mistveil-hunting-ground': { bestMasterLevel: 5, points: 316, cleared: true },
  'sea-ringed-reef': { bestMasterLevel: 5, points: 316, cleared: true }
};

test('the Season 3 configuration is authoritative and exact', () => {
  const c = runtime();
  const season = call(c, 'masterSeal', {}).season;
  assert.equal(season.id, 'season-3');
  assert.equal(season.maxScore, 3650);
  assert.deepEqual(season.dungeons.map(d => d.id), [
    'towering-ruin', 'tinas-mindrealm', 'cursed-radiant-tomb',
    'mech-facility', 'mistveil-hunting-ground', 'sea-ringed-reef'
  ]);
  assert.deepEqual(season.dungeons.map(d => d.number), [1, 2, 3, 4, 5, 6]);
  assert.equal(season.dungeons[0].name, 'Void - Towering Ruin');
  assert.equal(season.dungeons[1].name, "Void - Tina's Mindrealm");
  assert.deepEqual(season.rewards.map(r => r.score), [500, 1000, 1500, 2000, 2500, 3000, 3650]);
  assert.equal(season.rewards[6].rewardName, 'Mount: Neon Sonic');
  assert.equal(season.rewards[6].rewardType, 'mount');
  assert.deepEqual(season.rewards.slice(0, 4).map(r => r.quantity), [50, 50, 50, 50]);
});

test('members update their own six dungeons and totals are derived server-side', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Sealbearer' });
  const result = call(c, 'masterSealUpdate', { token: a.session.token, dungeons: SIX });
  assert.equal(result.changed, true);
  assert.equal(result.dungeons.length, 6);
  assert.equal(result.totals.totalScore, 1904);
  assert.equal(result.totals.remainingScore, 1746);
  assert.equal(result.totals.clearedCount, 6);
  assert.equal(result.totals.mountUnlocked, false);
  assert.ok(result.totals.progressPercent > 52 && result.totals.progressPercent < 53);
  const again = call(c, 'masterSealUpdate', { token: a.session.token, dungeons: SIX });
  assert.equal(again.changed, false);
});

test('partial updates only touch the submitted dungeons', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Partial' });
  call(c, 'masterSealUpdate', { token: a.session.token, dungeons: SIX });
  const result = call(c, 'masterSealUpdate', {
    token: a.session.token,
    dungeons: { 'towering-ruin': { bestMasterLevel: 6, points: 330, cleared: true } }
  });
  assert.equal(result.changed, true);
  assert.equal(result.totals.totalScore, 1904 - 316 + 330);
  const untouched = result.dungeons.find(d => d.dungeonId === 'sea-ringed-reef');
  assert.equal(untouched.points, 316);
});

test('the mount unlocks at exactly 3,650 and remaining never goes below zero', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Almost There' });
  const near = {};
  const points = [650, 600, 600, 600, 600, 599];
  const season = call(c, 'masterSeal', {}).season;
  season.dungeons.forEach((d, i) => { near[d.id] = { bestMasterLevel: 6, points: points[i], cleared: true }; });
  let totals = call(c, 'masterSealUpdate', { token: a.session.token, dungeons: near }).totals;
  assert.equal(totals.totalScore, 3649);
  assert.equal(totals.mountUnlocked, false);
  assert.equal(totals.remainingScore, 1);
  near['sea-ringed-reef'] = { bestMasterLevel: 6, points: 600, cleared: true };
  totals = call(c, 'masterSealUpdate', { token: a.session.token, dungeons: near }).totals;
  assert.equal(totals.totalScore, 3650);
  assert.equal(totals.mountUnlocked, true);
  assert.equal(totals.remainingScore, 0);
  assert.equal(totals.progressPercent, 100);
});

test('invalid Master Seal data is rejected', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Validator' });
  const cases = [
    { 'no-such-dungeon': { bestMasterLevel: 1, points: 10, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: 1, points: -5, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: 1, points: 4000, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: 21, points: 10, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: -1, points: 10, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: 2.5, points: 10, cleared: true } },
    { 'towering-ruin': { bestMasterLevel: 1, points: 10, cleared: 'yes' } },
    { 'towering-ruin': { bestMasterLevel: 1, points: 10, cleared: false } },
    { 'towering-ruin': { bestMasterLevel: null, points: 10, cleared: false } }
  ];
  cases.forEach(dungeons => {
    assert.throws(() => call(c, 'masterSealUpdate', { token: a.session.token, dungeons }), /Unknown dungeon|Invalid|true or false|Uncleared/);
  });
  const ok = call(c, 'masterSealUpdate', {
    token: a.session.token,
    dungeons: { 'towering-ruin': { bestMasterLevel: '', points: 0, cleared: false } }
  });
  assert.equal(ok.dungeons[0].bestMasterLevel, null);
  assert.equal(ok.dungeons[0].cleared, false);
});

test('updates require a valid session and my progress always returns six ordered dungeons', () => {
  const c = runtime();
  assert.throws(() => call(c, 'masterSealUpdate', { token: 'x'.repeat(64), dungeons: SIX }), /expired/);
  const a = call(c, 'createAccount', { characterName: 'Fresh' });
  const mine = call(c, 'myMasterSeal', { token: a.session.token });
  assert.equal(mine.dungeons.length, 6);
  assert.deepEqual(Array.from(mine.dungeons, d => d.points), [0, 0, 0, 0, 0, 0]);
  assert.equal(mine.totals.totalScore, 0);
  assert.equal(mine.totals.remainingScore, 3650);
  assert.equal(mine.totals.mountUnlocked, false);
});

test('the public board ranks by total score, includes zero-progress members and hides IDs', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Leader' });
  const b = call(c, 'createAccount', { characterName: 'Challenger' });
  call(c, 'createAccount', { characterName: 'Newcomer' });
  call(c, 'masterSealUpdate', { token: a.session.token, dungeons: SIX });
  call(c, 'masterSealUpdate', {
    token: b.session.token,
    dungeons: { 'towering-ruin': { bestMasterLevel: 4, points: 240, cleared: true } }
  });
  const board = call(c, 'masterSeal', {}).board;
  assert.deepEqual(Array.from(board, r => r.name), ['Leader', 'Challenger', 'Newcomer']);
  assert.deepEqual(Array.from(board, r => r.rank), [1, 2, 3]);
  assert.equal(board[2].totalScore, 0);
  assert.equal(board[2].dungeons.length, 6);
  board.forEach(row => {
    assert.equal('memberId' in row, false);
    assert.equal(row.dungeons.length, 6);
  });
});

test('administrators can correct another member’s seal with an audit trail; members cannot', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const member = call(c, 'createAccount', { characterName: 'Corrected' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  const edit = call(c, 'adminMasterSealEdit', {
    token: dax.session.token,
    memberId: member.member.memberId,
    dungeons: { 'mech-facility': { bestMasterLevel: 3, points: 150, cleared: true } }
  });
  assert.equal(edit.totals.totalScore, 150);
  assert.ok(c.readTable_(c.SHEETS.AUDIT).rows.some(r => r.Action === 'EDIT_MASTER_SEAL'));
  assert.throws(() => call(c, 'adminMasterSealEdit', {
    token: member.session.token,
    memberId: dax.member.memberId,
    dungeons: { 'mech-facility': { bestMasterLevel: 3, points: 150, cleared: true } }
  }), /Administrator access required/);
});

test('merging duplicates reassigns Master Seal progress to the kept member', () => {
  const c = runtime();
  const keep = call(c, 'createAccount', { characterName: 'Original' });
  const dupe = call(c, 'createAccount', { characterName: 'Original Two' });
  call(c, 'masterSealUpdate', {
    token: dupe.session.token,
    dungeons: { 'sea-ringed-reef': { bestMasterLevel: 5, points: 316, cleared: true } }
  });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminMerge', { token: recovery.token, keepMemberId: keep.member.memberId, removeMemberId: dupe.member.memberId });
  const mine = call(c, 'myMasterSeal', { token: keep.session.token });
  assert.equal(mine.totals.totalScore, 316);
  const board = call(c, 'masterSeal', {}).board;
  assert.deepEqual(Array.from(board, r => r.name), ['Original']);
});
