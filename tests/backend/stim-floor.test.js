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
