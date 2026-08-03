const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call, legacySession } = require('./runtime');

/**
 * Rebuild the pre-upgrade schema exactly as the PIN-era deployment created it:
 * Members with seven columns (including PIN material), Sessions with six.
 */
function seedOldSchema(c) {
  const ss = c.SpreadsheetApp.getActiveSpreadsheet();
  const members = ss.insertSheet('Members');
  members.appendRow(['MemberId', 'CharacterName', 'NormalizedName', 'PinSalt', 'PinHash', 'CreatedAt', 'DisabledAt']);
  members.appendRow(['MEM-legacy-dax', 'Dax', 'dax', 'salt-dax', 'hash-dax', '2026-06-01', '']);
  members.appendRow(['MEM-legacy-two', 'Old Guildie', 'old guildie', 'salt-two', 'hash-two', '2026-06-02', '']);
  const sessions = ss.insertSheet('Sessions');
  sessions.appendRow(['TokenHash', 'MemberId', 'Kind', 'ExpiresAt', 'RevokedAt', 'CreatedAt']);
  const players = ss.getSheetByName(c.SHEETS.PLAYERS);
  players.appendRow(['MEM-legacy-dax', 'Dax', 41, '2026-06-10', false, '', false, '', 480, '2026-06-11', false, '', '', '', '2026-06-11', '2026-06-01', true, '']);
  players.appendRow(['MEM-legacy-two', 'Old Guildie', 12, '2026-06-05', false, '', false, '', 100, '2026-06-06', false, '', '', '', '2026-06-06', '2026-06-02', false, '']);
  return { members, sessions };
}

function snapshot(c) {
  const names = ['Members', 'Sessions', 'Players', 'MasterSeal', 'LoginAttempts'];
  const state = {};
  for (const name of names) {
    const sheet = c.__sheets[name];
    state[name] = sheet ? JSON.parse(JSON.stringify(sheet.rows)) : null;
  }
  return state;
}

test('setup upgrades the old schema by appending columns without touching existing rows', () => {
  const c = runtime();
  const { members, sessions } = seedOldSchema(c);
  c.setupSpreadsheet();

  assert.deepEqual(members.rows[0], [
    'MemberId', 'CharacterName', 'NormalizedName', 'PinSalt', 'PinHash', 'CreatedAt', 'DisabledAt',
    'BackupCode', 'BackupCodeCreatedAt', 'BackupCodeUpdatedAt', 'LastAccessAt'
  ]);
  assert.deepEqual(sessions.rows[0], [
    'TokenHash', 'MemberId', 'Kind', 'ExpiresAt', 'RevokedAt', 'CreatedAt', 'LastUsedAt',
    'GroupRootMemberId', 'ActiveMemberId', 'AccountGroupAccess'
  ]);
  // Existing identity and PIN material stays exactly where it was (dormant).
  assert.deepEqual(members.rows[1].slice(0, 7),
    ['MEM-legacy-dax', 'Dax', 'dax', 'salt-dax', 'hash-dax', '2026-06-01', '']);
  assert.deepEqual(members.rows[2].slice(0, 7),
    ['MEM-legacy-two', 'Old Guildie', 'old guildie', 'salt-two', 'hash-two', '2026-06-02', '']);
});

test('setup is idempotent: a second run changes nothing and erases no codes or sessions', () => {
  const c = runtime();
  seedOldSchema(c);
  c.setupSpreadsheet();

  const migrated = call(c, 'migrate', { token: legacySession(c, 'MEM-legacy-dax') });
  assert.equal(migrated.member.memberId, 'MEM-legacy-dax');
  const before = snapshot(c);

  c.setupSpreadsheet();
  assert.deepEqual(snapshot(c), before, 'second setup run must be a no-op for data');

  // The generated code still restores after the second setup run.
  const restored = call(c, 'restore', { characterName: 'Dax', backupCode: migrated.backupCode });
  assert.equal(restored.member.memberId, 'MEM-legacy-dax');
});

test('setup creates missing progression links and recovery records without changing existing player data', () => {
  const c = runtime();
  const member = call(c, 'createAccount', { characterName: 'Dax' }).member;
  const players = c.readTable_('Players');
  players.sheet.deleteRow(players.rows[0]._row);
  const memberTable = c.readTable_(c.AUTH_SHEETS.MEMBERS);
  const memberRow = memberTable.rows.find(r => String(r.MemberId) === String(member.memberId));
  memberTable.sheet.getRange(memberRow._row, memberTable.headers.indexOf('BackupCode') + 1).setValue('');
  c.setupSpreadsheet();
  const repaired = c.readTable_('Players').rows.filter(r => String(r.UserId) === String(member.memberId));
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].CharacterName, 'Dax');
  const members = c.readTable_(c.AUTH_SHEETS.MEMBERS).rows.filter(r => String(r.MemberId) === String(member.memberId));
  assert.match(String(members[0].BackupCode), /^BPSR-/);
  const codes = c.readTable_(c.AUTH_SHEETS.CODES).rows.filter(r => String(r.MemberId) === String(member.memberId));
  assert.equal(codes.length, 1);
  assert.equal(codes[0].BackupCode, members[0].BackupCode);
});

test('legacy members migrate in place: same IDs, same links, same progression, roles preserved', () => {
  const c = runtime();
  seedOldSchema(c);
  c.setupSpreadsheet();

  const migrated = call(c, 'migrate', { token: legacySession(c, 'MEM-legacy-dax') });
  assert.equal(migrated.member.memberId, 'MEM-legacy-dax');
  assert.equal(migrated.member.characterName, 'Dax');
  assert.equal(migrated.member.svFloor, 41);
  assert.equal(migrated.member.masterPoints, 480);
  assert.equal(migrated.member.isAdmin, true);
  assert.match(migrated.backupCode, /^BPSR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(call(c, 'adminMembers', { token: migrated.session.token }).length, 2);

  // Migration is one-way per token: the old token is revoked after exchange.
  const second = call(c, 'migrate', { token: legacySession(c, 'MEM-legacy-two') });
  assert.equal(second.member.memberId, 'MEM-legacy-two');
  assert.equal(second.member.isAdmin, false);
  assert.notEqual(second.backupCode, migrated.backupCode);
});

test('PIN material stays dormant in the sheet and never reaches any API response', () => {
  const c = runtime();
  seedOldSchema(c);
  c.setupSpreadsheet();
  const migrated = call(c, 'migrate', { token: legacySession(c, 'MEM-legacy-dax') });

  const surfaces = [
    JSON.stringify(migrated),
    JSON.stringify(call(c, 'leaderboard', {})),
    JSON.stringify(call(c, 'masterSeal', {})),
    JSON.stringify(call(c, 'adminMembers', { token: migrated.session.token })),
    JSON.stringify(call(c, 'adminRead', { token: migrated.session.token, memberId: 'MEM-legacy-two' })),
    JSON.stringify(call(c, 'adminBackupCode', { token: migrated.session.token, memberId: 'MEM-legacy-two' }))
  ];
  for (const payload of surfaces) {
    assert.equal(payload.includes('salt-'), false, 'PIN salt leaked');
    assert.equal(payload.includes('hash-'), false, 'PIN hash leaked');
  }
  // PIN authentication is inactive, but the columns survive for rollback.
  assert.throws(() => call(c, 'login', { characterName: 'Dax', pin: '123456' }), /Unknown action/);
  const members = c.readTable_(c.AUTH_SHEETS.MEMBERS);
  assert.equal(members.rows[0].PinSalt, 'salt-dax');
});

test('duplicate Master Seal rows are deterministic: the last row wins and points are never double-counted', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Doubled' });
  const seal = c.__sheets.MasterSeal;
  seal.appendRow([a.member.memberId, 'towering-ruin', 4, 200, true, new Date()]);
  seal.appendRow([a.member.memberId, 'towering-ruin', 5, 316, true, new Date()]);

  const mine = call(c, 'myMasterSeal', { token: a.session.token });
  assert.equal(mine.totals.totalScore, 316, 'last duplicate row wins; no double counting');
  assert.equal(mine.dungeons.find(d => d.dungeonId === 'towering-ruin').bestMasterLevel, 5);

  // An update writes through to the surviving (last) row deterministically.
  const updated = call(c, 'masterSealUpdate', {
    token: a.session.token,
    dungeons: { 'towering-ruin': { bestMasterLevel: 6, points: 330, cleared: true } }
  });
  assert.equal(updated.totals.totalScore, 330);
});
