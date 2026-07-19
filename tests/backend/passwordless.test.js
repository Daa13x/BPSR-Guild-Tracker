const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call, sessions, setConfig, legacySession } = require('./runtime');

test('backup codes are unique per account and tolerate case and separator differences', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Alpha' });
  const b = call(c, 'createAccount', { characterName: 'Beta' });
  assert.notEqual(a.backupCode, b.backupCode);
  const spaced = a.backupCode.toLowerCase().replace(/-/g, ' ');
  const restored = call(c, 'restore', { characterName: 'Alpha', backupCode: spaced });
  assert.equal(restored.member.memberId, a.member.memberId);
});

test('restore never reveals whether a character name exists', () => {
  const c = runtime();
  call(c, 'createAccount', { characterName: 'Existing Member' });
  let missing, wrong;
  try { call(c, 'restore', { characterName: 'No Such Member', backupCode: 'BPSR-AAAA-BBBB-CCCC' }); } catch (e) { missing = e; }
  try { call(c, 'restore', { characterName: 'Existing Member', backupCode: 'BPSR-AAAA-BBBB-CCCC' }); } catch (e) { wrong = e; }
  assert.equal(missing.message, 'Character name or backup code is incorrect.');
  assert.equal(wrong.message, missing.message);
  assert.equal(missing.code, wrong.code);
});

test('remembered-device sessions default to 180 days and honour MEMBER_SESSION_DAYS', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Long Session' });
  const days = (new Date(a.session.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 179 && days < 181, `expected ~180 days, got ${days}`);
  setConfig(c, 'MEMBER_SESSION_DAYS', '2');
  const b = call(c, 'createAccount', { characterName: 'Short Session' });
  const shortDays = (new Date(b.session.expiresAt) - Date.now()) / 86400000;
  assert.ok(shortDays > 1.9 && shortDays < 2.1, `expected ~2 days, got ${shortDays}`);
});

test('members read their own backup code only through a valid session', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Code Owner' });
  const mine = call(c, 'myBackupCode', { token: a.session.token });
  assert.equal(mine.backupCode, a.backupCode);
  assert.ok(mine.createdAt);
  assert.throws(() => call(c, 'myBackupCode', { token: 'x'.repeat(64) }), /expired/);
});

test('revoking all devices ends every remembered session for that member only', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Multi Device' });
  const b = call(c, 'createAccount', { characterName: 'Bystander' });
  const second = call(c, 'restore', { characterName: 'Multi Device', backupCode: a.backupCode });
  call(c, 'revokeAllDevices', { token: a.session.token });
  assert.throws(() => call(c, 'me', { token: a.session.token }), /expired/);
  assert.throws(() => call(c, 'me', { token: second.session.token }), /expired/);
  assert.equal(call(c, 'me', { token: b.session.token }).characterName, 'Bystander');
});

test('a valid legacy session migrates to a remembered-device session with the same member and a saved code', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Veteran' });
  call(c, 'progress', { token: a.session.token, svFloor: 41 });
  const oldToken = legacySession(c, a.member.memberId);
  const migrated = call(c, 'migrate', { token: oldToken });
  assert.equal(migrated.member.memberId, a.member.memberId);
  assert.equal(migrated.member.svFloor, 41);
  assert.equal(migrated.backupCode, a.backupCode);
  assert.ok((new Date(migrated.session.expiresAt) - Date.now()) / 86400000 > 100);
  assert.throws(() => call(c, 'me', { token: oldToken }), /expired/);
  assert.equal(call(c, 'me', { token: migrated.session.token }).characterName, 'Veteran');
});

test('migration generates a backup code for legacy members who never had one', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'No Code Yet' });
  const members = c.readTable_(c.AUTH_SHEETS.MEMBERS);
  const row = members.rows.find(r => String(r.MemberId) === String(a.member.memberId));
  const codeCol = members.headers.indexOf('BackupCode') + 1;
  members.sheet.getRange(row._row, codeCol, 1, 3).setValues([['', '', '']]);
  const oldToken = legacySession(c, a.member.memberId);
  const migrated = call(c, 'migrate', { token: oldToken });
  assert.match(migrated.backupCode, /^BPSR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const restored = call(c, 'restore', { characterName: 'No Code Yet', backupCode: migrated.backupCode });
  assert.equal(restored.member.memberId, a.member.memberId);
});

test('migration preserves administrator roles', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  const migrated = call(c, 'migrate', { token: legacySession(c, dax.member.memberId) });
  assert.equal(migrated.member.isAdmin, true);
  assert.equal(call(c, 'adminMembers', { token: migrated.session.token }).length, 1);
});

test('administrators can reveal, copy-ready read and regenerate codes; old codes die immediately', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const member = call(c, 'createAccount', { characterName: 'Forgetful' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  const revealed = call(c, 'adminBackupCode', { token: dax.session.token, memberId: member.member.memberId });
  assert.equal(revealed.backupCode, member.backupCode);
  const regenerated = call(c, 'adminRegenerateBackupCode', { token: dax.session.token, memberId: member.member.memberId });
  assert.notEqual(regenerated.backupCode, member.backupCode);
  assert.throws(() => call(c, 'restore', { characterName: 'Forgetful', backupCode: member.backupCode }), /incorrect/);
  const restored = call(c, 'restore', { characterName: 'Forgetful', backupCode: regenerated.backupCode });
  assert.equal(restored.member.memberId, member.member.memberId);
});

test('regeneration can revoke devices, and admins can revoke devices without regenerating', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const member = call(c, 'createAccount', { characterName: 'Compromised' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  call(c, 'adminRegenerateBackupCode', { token: dax.session.token, memberId: member.member.memberId, revokeSessions: true });
  assert.throws(() => call(c, 'me', { token: member.session.token }), /expired/);
  const second = call(c, 'createAccount', { characterName: 'Second Device' });
  call(c, 'adminRevokeSessions', { token: dax.session.token, memberId: second.member.memberId });
  assert.throws(() => call(c, 'me', { token: second.session.token }), /expired/);
});

test('ordinary members cannot reach another member’s code or admin recovery actions', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Plain Member' });
  const b = call(c, 'createAccount', { characterName: 'Target' });
  ['adminBackupCode', 'adminRegenerateBackupCode', 'adminRevokeSessions'].forEach(action => {
    assert.throws(() => call(c, action, { token: a.session.token, memberId: b.member.memberId }), /Administrator access required/);
  });
});

test('backup codes never appear in public payloads, admin listings or the audit log', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const member = call(c, 'createAccount', { characterName: 'Private Person' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  call(c, 'adminBackupCode', { token: dax.session.token, memberId: member.member.memberId });
  call(c, 'adminRegenerateBackupCode', { token: dax.session.token, memberId: member.member.memberId });
  const currentCode = call(c, 'adminBackupCode', { token: dax.session.token, memberId: member.member.memberId }).backupCode;
  const codes = [member.backupCode, dax.backupCode, currentCode].map(code => code.replace(/-/g, ''));
  const surfaces = {
    leaderboard: JSON.stringify(call(c, 'leaderboard', {})),
    masterSeal: JSON.stringify(call(c, 'masterSeal', {})),
    adminMembers: JSON.stringify(call(c, 'adminMembers', { token: dax.session.token })),
    audit: JSON.stringify(c.readTable_(c.SHEETS.AUDIT).rows)
  };
  Object.keys(surfaces).forEach(surface => {
    codes.forEach(code => {
      assert.equal(surfaces[surface].replace(/-/g, '').includes(code), false, `${surface} leaked a backup code`);
    });
  });
  const listing = call(c, 'adminMembers', { token: dax.session.token });
  assert.equal(typeof listing[0].backupCodeSet, 'boolean');
  assert.equal('backupCode' in listing[0], false);
});

test('session and account metadata reach administrators for practical recovery', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  const read = call(c, 'adminRead', { token: dax.session.token, memberId: dax.member.memberId });
  assert.equal(read.backupCodeSet, true);
  assert.ok(read.backupCodeCreatedAt);
  assert.ok(read.lastAccessAt);
  assert.equal(read.activeSessions, 1);
  assert.equal(read.disabled, false);
});
