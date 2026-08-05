const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

/** The Stim Vault floor is the SV Leaderboard floor: one value, biweekly reset. */

function playerRow(c, memberId) {
  const t = c.readTable_('Players');
  return { table: t, row: t.rows.filter(r => String(r.UserId) === String(memberId))[0] };
}
function setCell(c, memberId, header, value) {
  const { table, row } = playerRow(c, memberId);
  table.sheet.getRange(row._row, table.headers.indexOf(header) + 1).setValue(value);
}
function setMemberCell(c, memberId, header, value) {
  const t = c.readTable_(c.AUTH_SHEETS.MEMBERS);
  const row = t.rows.filter(r => String(r.MemberId) === String(memberId))[0];
  t.sheet.getRange(row._row, t.headers.indexOf(header) + 1).setValue(value);
}

test('the reset boundary is every second Monday at 07:00 UTC (05:00 UTC-2)', () => {
  const c = runtime();
  const anchor = '2026-08-03T07:00:00Z';               // a Monday
  const at = iso => c.lastStimReset_(new Date(iso), anchor).toISOString();
  assert.equal(at('2026-08-10T12:00:00Z'), '2026-08-03T07:00:00.000Z', 'mid-fortnight holds the last boundary');
  assert.equal(at('2026-08-17T07:00:00Z'), '2026-08-17T07:00:00.000Z', 'the next reset is 14 days on, still a Monday');
  assert.equal(at('2026-08-03T06:59:59Z'), '2026-07-20T07:00:00.000Z', 'just before a reset belongs to the prior fortnight');
  assert.equal(c.stimVaultStale_(null, new Date('2026-08-10T00:00:00Z'), anchor), false, 'a first visit is not a reset');
  assert.equal(c.stimVaultStale_('2026-08-02', new Date('2026-08-10'), anchor), true, 'seen before the boundary is stale');
  assert.equal(c.stimVaultStale_('2026-08-05', new Date('2026-08-10'), anchor), false, 'seen after the boundary is fresh');
});

test('editing the Stim Vault floor drives the SV Leaderboard', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const token = dax.session.token;

  const saved = call(c, 'masterSealUpdate', { token, dungeons: {}, stimVault: { points: 60, bestMasterLevel: null } });
  assert.equal(saved.stimVault.points, 60);
  assert.equal(saved.stimVault.max, 60, 'floors cap at 60, not the season score');

  const board = call(c, 'leaderboard', { token }).svBoard.filter(r => r.name === 'Dax')[0];
  assert.equal(board.sv, 60);
  assert.equal(board.svPct, 100);
  assert.equal(board.svComplete, true);
  assert.equal(call(c, 'myMasterSeal', { token }).stimVault.points, 60, 'the editor reads the same floor');

  // It stays out of the Master Seal season totals — it is a floor, not a score.
  assert.equal(call(c, 'myMasterSeal', { token }).totals.totalScore, 0);
});

const DIFF = (over) => Object.assign({ easy: false, hard: false, nmRaidCompleted: false, easyHardRaidCompleted: false, master: false }, over || {});

test('Easy, Hard, both Raid difficulties and Master save independently with their dates', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const saved = call(c, 'masterSealUpdate', {
    token: dax.session.token, dungeons: {}, difficulty: DIFF({ easy: true, hard: true, nmRaidCompleted: true, easyHardRaidCompleted: true, master: true })
  });
  assert.equal(saved.difficulty.nmRaidCompleted, true);
  assert.equal(saved.difficulty.easyHardRaidCompleted, true);
  assert.ok(saved.difficulty.nmRaidDate);
  assert.ok(saved.difficulty.easyHardRaidDate);
  const { row } = playerRow(c, dax.member.memberId);
  assert.equal(row.NMRaidComplete, true);
  assert.equal(row.EHRaidComplete, true);
  assert.equal(row.RaidComplete, '', 'legacy combined column is retired on save');
  assert.ok(row.NMRaidDate instanceof Date);
  assert.ok(row.EHRaidDate instanceof Date);

  // Clearing one raid difficulty must not touch the other.
  const cleared = call(c, 'masterSealUpdate', {
    token: dax.session.token, dungeons: {}, difficulty: DIFF({ easy: true, hard: true, nmRaidCompleted: false, easyHardRaidCompleted: true, master: true })
  });
  assert.equal(cleared.difficulty.nmRaidCompleted, false);
  assert.equal(cleared.difficulty.easyHardRaidCompleted, true, 'Easy/Hard Raid unchanged when NM cleared');

  const loaded = call(c, 'myMasterSeal', { token: dax.session.token });
  assert.equal(loaded.difficulty.nmRaidCompleted, false);
  assert.equal(loaded.difficulty.easyHardRaidCompleted, true);
});

test('a stale load clears the floor for the new fortnight on both the editor and the board', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const token = dax.session.token;
  call(c, 'masterSealUpdate', { token, dungeons: {}, stimVault: { points: 45 } });

  // Pretend the floor was last set before the current fortnight's reset.
  setCell(c, dax.member.memberId, 'SVFloorDate', new Date('2026-07-01T00:00:00Z'));
  call(c, 'leaderboard', { token });                    // the viewer's load triggers the reset

  assert.equal(call(c, 'myMasterSeal', { token }).stimVault.points, 0, 'floor cleared for the new fortnight');
  assert.equal(call(c, 'leaderboard', { token }).svBoard.filter(r => r.name === 'Dax')[0].sv, 0);
});

test('the floor is not cleared within the same fortnight', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const token = dax.session.token;
  call(c, 'masterSealUpdate', { token, dungeons: {}, stimVault: { points: 30 } });
  // SVFloorDate is "now" (this fortnight); a reload must not reset it.
  call(c, 'leaderboard', { token });
  assert.equal(call(c, 'myMasterSeal', { token }).stimVault.points, 30, 'a fresh floor survives a reload');
});

test('NM Raid and Easy/Hard Raid reset weekly on Monday, each independently', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  call(c, 'masterSealUpdate', {
    token: dax.session.token, dungeons: {}, difficulty: DIFF({ nmRaidCompleted: true, easyHardRaidCompleted: true })
  });
  const anchor = '2026-08-03T07:00:00Z';
  assert.equal(c.lastRaidReset_(new Date('2026-08-10T07:00:00Z'), anchor).toISOString(), '2026-08-10T07:00:00.000Z');
  // Only NM Raid is stale; Easy/Hard Raid was completed this week.
  setCell(c, dax.member.memberId, 'NMRaidDate', new Date('2026-07-20T07:00:00Z'));
  setCell(c, dax.member.memberId, 'EHRaidDate', new Date('2026-08-10T09:00:00Z'));
  assert.equal(c.applyRaidReset_(dax.member.memberId, new Date('2026-08-10T12:00:00Z')), true);
  const { row } = playerRow(c, dax.member.memberId);
  assert.equal(row.NMRaidComplete, false, 'stale NM Raid cleared');
  assert.equal(row.EHRaidComplete, true, 'fresh Easy/Hard Raid preserved');
});

test('Master Seal board applies the weekly Raid reset without per-member identity lookups', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  call(c, 'masterSealUpdate', { token: dax.session.token, dungeons: {}, difficulty: DIFF({ nmRaidCompleted: true, easyHardRaidCompleted: true }) });
  const stale = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  setCell(c, dax.member.memberId, 'NMRaidDate', stale);
  setCell(c, dax.member.memberId, 'EHRaidDate', stale);
  const original = c.linkedPlayer_;
  c.linkedPlayer_ = function () { throw new Error('board must use its loaded Players rows'); };
  const board = c.masterSealBoard_('');
  c.linkedPlayer_ = original;
  assert.equal(board.board[0].nmRaid, false);
  assert.equal(board.board[0].easyHardRaid, false);
});

test('legacy combined Raid data migrates into Easy/Hard on first load and never re-writes the old column', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  // Simulate a pre-split record: legacy RaidComplete true, no NM/EH columns set.
  setCell(c, dax.member.memberId, 'RaidComplete', true);
  setCell(c, dax.member.memberId, 'RaidDate', new Date('2026-08-04T00:00:00Z'));
  setCell(c, dax.member.memberId, 'NMRaidComplete', '');
  setCell(c, dax.member.memberId, 'EHRaidComplete', '');
  const loaded = call(c, 'myMasterSeal', { token: dax.session.token });
  assert.equal(loaded.difficulty.easyHardRaidCompleted, true, 'legacy Raid -> Easy/Hard');
  assert.equal(loaded.difficulty.nmRaidCompleted, false, 'NM defaults to false');
  const { row } = playerRow(c, dax.member.memberId);
  assert.equal(row.EHRaidComplete, true);
  assert.equal(row.RaidComplete, '', 'legacy column cleared after migration');
  // Re-running is idempotent and does not corrupt the migrated value.
  const again = call(c, 'myMasterSeal', { token: dax.session.token });
  assert.equal(again.difficulty.easyHardRaidCompleted, true);
});

test('legacy incomplete Raid migrates to Easy/Hard false, and missing raid data reads as false', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  setCell(c, dax.member.memberId, 'RaidComplete', false);
  setCell(c, dax.member.memberId, 'NMRaidComplete', '');
  setCell(c, dax.member.memberId, 'EHRaidComplete', '');
  const loaded = call(c, 'myMasterSeal', { token: dax.session.token });
  assert.equal(loaded.difficulty.easyHardRaidCompleted, false);
  assert.equal(loaded.difficulty.nmRaidCompleted, false);
  // Garbage in the legacy column is treated as not-complete, never thrown.
  const aria = call(c, 'createAccount', { characterName: 'Aria' });
  setCell(c, aria.member.memberId, 'RaidComplete', 'garbage');
  setCell(c, aria.member.memberId, 'EHRaidComplete', '');
  assert.equal(call(c, 'myMasterSeal', { token: aria.session.token }).difficulty.easyHardRaidCompleted, false);
});

test('the server rejects a difficulty payload missing the separated raid booleans', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  assert.throws(() => call(c, 'masterSealUpdate', {
    token: dax.session.token, dungeons: {}, difficulty: { easy: true, hard: true, raid: true, master: true }
  }), /true or false/);
});

test('the Master Seal board carries each member SV floor for display and sorting', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const aria = call(c, 'createAccount', { characterName: 'Aria' });
  call(c, 'masterSealUpdate', { token: dax.session.token, dungeons: {}, stimVault: { points: 40 } });
  call(c, 'masterSealUpdate', { token: aria.session.token, dungeons: {}, stimVault: { points: 12 } });
  const board = call(c, 'masterSeal', {}).board;
  const floors = {};
  board.forEach(r => { floors[r.name] = r.svFloor; });
  assert.equal(floors.Dax, 40);
  assert.equal(floors.Aria, 12);
});

test('Master Seal joins SVFloor by stable member id, not display name', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const aria = call(c, 'createAccount', { characterName: 'Aria' });
  call(c, 'masterSealUpdate', { token: dax.session.token, dungeons: {}, stimVault: { points: 5 } });
  call(c, 'masterSealUpdate', { token: aria.session.token, dungeons: {}, stimVault: { points: 55 } });
  setMemberCell(c, dax.member.memberId, 'CharacterName', 'Aria');
  setMemberCell(c, aria.member.memberId, 'CharacterName', 'Dax');
  const floors = Object.fromEntries(call(c, 'masterSeal', {}).board.map(r => [r.name, r.svFloor]));
  assert.equal(floors.Aria, 5);
  assert.equal(floors.Dax, 55);
});

test('Master Seal normalises numeric strings, preserves zero and reports invalid source values', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  setCell(c, dax.member.memberId, 'SVFloor', '20');
  assert.equal(call(c, 'masterSeal', {}).board[0].svFloor, 20);
  setCell(c, dax.member.memberId, 'SVFloor', '0');
  assert.equal(call(c, 'masterSeal', {}).board[0].svFloor, 0);
  setCell(c, dax.member.memberId, 'SVFloor', 'not-a-floor');
  assert.equal(call(c, 'masterSeal', {}).board[0].svFloor, null);
});
