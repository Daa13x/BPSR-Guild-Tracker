const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call, sessions } = require('./runtime');

test('GET returns a safe JSON health response without loading HTML or private services', () => {
  const c = runtime();
  let htmlCalls = 0, sheetReads = 0, propertyReads = 0, sessionReads = 0;
  c.HtmlService.createHtmlOutputFromFile = () => { htmlCalls++; throw new Error('HTML hosting must not be used'); };
  c.SpreadsheetApp.getActiveSpreadsheet = () => { sheetReads++; throw new Error('GET must not read Sheets'); };
  c.PropertiesService.getScriptProperties = () => { propertyReads++; throw new Error('GET must not read Script Properties'); };
  c.Session.getActiveUser = () => { sessionReads++; throw new Error('GET must not read user data'); };
  const response = c.doGet({ parameter: { action: 'adminMembers', token: 'DO_NOT_ECHO' } }), body = JSON.parse(response.text);
  assert.deepEqual([htmlCalls, sheetReads, propertyReads, sessionReads], [0, 0, 0, 0]);
  assert.equal(response.mimeType, c.ContentService.MimeType.JSON);
  assert.deepEqual(body, { ok: true, service: 'BPSR Guild Tracker API', status: 'ready', message: 'Use POST requests for API actions.' });
  const serialized = response.text.toLowerCase();
  ['do_not_echo', 'spreadsheet', 'memberid', 'pin', 'hash', 'salt', 'session', 'script properties', 'deployment', 'administrator'].forEach(term => assert.equal(serialized.includes(term), false));
});

test('accounts create with only a character name, normalize it and restore with the backup code', () => {
  const c = runtime();
  const created = call(c, 'createAccount', { characterName: ' Alpha  One ' });
  assert.equal(created.member.characterName, 'Alpha One');
  assert.match(created.backupCode, /^BPSR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.throws(() => call(c, 'createAccount', { characterName: 'alpha one' }), /already has an account/);
  const restored = call(c, 'restore', { characterName: 'ALPHA ONE', backupCode: created.backupCode.toLowerCase() });
  assert.equal(restored.member.memberId, created.member.memberId);
  assert.ok(restored.session.token.length > 40);
  assert.equal(call(c, 'me', { token: restored.session.token }).svFloor, 0);
  call(c, 'logout', { token: restored.session.token });
  assert.throws(() => call(c, 'me', { token: restored.session.token }), /expired/);
});

test('backend validates SV, ownership and genuine updates', () => {
  const c = runtime();
  const a = call(c, 'createAccount', { characterName: 'Alpha One' });
  const b = call(c, 'createAccount', { characterName: 'Beta Two' });
  assert.throws(() => call(c, 'progress', { token: a.session.token, svFloor: 0 }), /Invalid/);
  assert.throws(() => call(c, 'progress', { token: a.session.token, svFloor: 61 }), /Invalid/);
  assert.equal(call(c, 'progress', { token: a.session.token, svFloor: 1 }).changed, true);
  assert.equal(call(c, 'progress', { token: a.session.token, svFloor: 1 }).changed, false);
  assert.equal(call(c, 'me', { token: b.session.token }).characterName, 'Beta Two');
});

test('master activities, restore throttling, admin authorization and the safe API envelope work', () => {
  const c = runtime();
  const m = call(c, 'createAccount', { characterName: 'Gamma Three' });
  assert.ok(call(c, 'activities').length);
  assert.throws(() => call(c, 'progress', { token: m.session.token, masterRanks: { NOPE: 1 } }), /Invalid/);
  assert.equal(call(c, 'progress', { token: m.session.token, masterRanks: { ACT1: 1 } }).changed, true);
  for (let i = 0; i < 5; i++) assert.throws(() => call(c, 'restore', { characterName: 'Gamma Three', backupCode: 'BPSR-WRNG-WRNG-WRN2' }), /incorrect/);
  assert.throws(() => call(c, 'restore', { characterName: 'Gamma Three', backupCode: m.backupCode }), /incorrect/);
  assert.throws(() => call(c, 'adminMembers', { token: m.session.token }), /Administrator access required/);
  const ad = call(c, 'adminLogin', { secret: 'secret' });
  assert.equal(call(c, 'adminMembers', { token: ad.session.token }).length, 1);
  const bad = JSON.parse(c.doPost({ postData: { contents: '{' } }).text);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'REQUEST_FAILED');
});

test('member roles authorize the member session live, support audited promotion and protect the last admin', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const other = call(c, 'createAccount', { characterName: 'Guildie' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  assert.equal(call(c, 'adminMembers', { token: dax.session.token }).length, 2);
  assert.throws(() => call(c, 'adminMembers', { token: other.session.token }), /Administrator access required/);
  assert.throws(() => call(c, 'adminSetRole', { token: dax.session.token, memberId: dax.member.memberId, isAdmin: false, confirmSelf: true }), /last active/i);
  call(c, 'adminSetRole', { token: dax.session.token, memberId: other.member.memberId, isAdmin: true });
  assert.equal(call(c, 'refresh', { token: other.session.token, kind: 'member' }).profile.isAdmin, true);
  assert.equal(call(c, 'adminMembers', { token: other.session.token }).length, 2);
  call(c, 'adminSetRole', { token: dax.session.token, memberId: other.member.memberId, isAdmin: false });
  assert.throws(() => call(c, 'adminMembers', { token: other.session.token }), /Administrator access required/);
  assert.ok(c.readTable_(c.SHEETS.AUDIT).rows.some(r => r.Action === 'SET_ADMIN_ROLE'));
});

test('refresh restores the profile without creating or replacing sessions', () => {
  const c = runtime();
  const m = call(c, 'createAccount', { characterName: 'Dax' });
  const rows = sessions(c).length;
  for (let i = 0; i < 3; i++) {
    const refreshed = call(c, 'refresh', { token: m.session.token, kind: 'member' });
    assert.equal(refreshed.profile.characterName, 'Dax');
    assert.equal(sessions(c).length, rows);
  }
});

test('creating an account issues exactly one remembered-device session and never an admin-kind session', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  assert.equal(sessions(c, 'member', dax.member.memberId).length, 1);
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  assert.equal(call(c, 'adminMembers', { token: dax.session.token }).length, 1);
  assert.equal(sessions(c, 'admin').length, 1); // only the bootstrap recovery session
  assert.equal(sessions(c, 'admin', dax.member.memberId).length, 0);
});

test('logout revokes only one token and disabled members cannot restore', () => {
  const c = runtime();
  const acc = call(c, 'createAccount', { characterName: 'Sessions' });
  const two = call(c, 'restore', { characterName: 'Sessions', backupCode: acc.backupCode });
  call(c, 'logout', { token: acc.session.token, kind: 'member' });
  assert.throws(() => call(c, 'me', { token: acc.session.token }), /expired/);
  assert.equal(call(c, 'me', { token: two.session.token }).characterName, 'Sessions');
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminDisable', { token: recovery.token, memberId: acc.member.memberId });
  assert.throws(() => call(c, 'me', { token: two.session.token }), /expired/);
  assert.throws(() => call(c, 'restore', { characterName: 'Sessions', backupCode: acc.backupCode }), /incorrect/);
});

test('role and disabled payloads are strict booleans and last-admin disable is blocked', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  assert.throws(() => call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: 'true' }), /true or false/);
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  assert.throws(() => call(c, 'adminSetDisabled', { token: dax.session.token, memberId: dax.member.memberId, disabled: 'false' }), /true or false/);
  assert.throws(() => call(c, 'adminSetDisabled', { token: dax.session.token, memberId: dax.member.memberId, disabled: true }), /last active/i);
  assert.equal(call(c, 'me', { token: dax.session.token }).isAdmin, true);
});

test('self-demotion needs confirmation and demoted member tokens lose admin access immediately', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const second = call(c, 'createAccount', { characterName: 'Second Admin' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  call(c, 'adminSetRole', { token: recovery.token, memberId: second.member.memberId, isAdmin: true });
  assert.throws(() => call(c, 'adminSetRole', { token: dax.session.token, memberId: dax.member.memberId, isAdmin: false }), /Self-demotion/);
  call(c, 'adminSetRole', { token: dax.session.token, memberId: dax.member.memberId, isAdmin: false, confirmSelf: true });
  assert.throws(() => call(c, 'adminMembers', { token: dax.session.token }), /Administrator access required/);
  assert.equal(call(c, 'me', { token: dax.session.token }).isAdmin, false);
});

test('signing out one device keeps an administrator’s other remembered devices working', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  const second = call(c, 'restore', { characterName: 'Dax', backupCode: dax.backupCode });
  call(c, 'logout', { token: dax.session.token, kind: 'member' });
  assert.throws(() => call(c, 'adminMembers', { token: dax.session.token }), /expired|Administrator/);
  assert.equal(call(c, 'adminMembers', { token: second.session.token }).length, 1);
});

test('disabling an administrator revokes that member’s sessions and preserves other administrators', () => {
  const c = runtime();
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const second = call(c, 'createAccount', { characterName: 'Second Admin' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  call(c, 'adminSetRole', { token: recovery.token, memberId: second.member.memberId, isAdmin: true });
  call(c, 'adminSetDisabled', { token: second.session.token, memberId: dax.member.memberId, disabled: true });
  assert.throws(() => call(c, 'me', { token: dax.session.token }), /expired/);
  assert.throws(() => call(c, 'adminMembers', { token: dax.session.token }), /expired|Administrator/);
  assert.equal(call(c, 'adminMembers', { token: second.session.token }).length, 2);
});

test('profiles expose role and stable ID without secrets, and identity mismatches fail closed', () => {
  const c = runtime();
  const registered = call(c, 'createAccount', { characterName: 'Safe Profile' });
  const json = JSON.stringify(registered.member).toLowerCase();
  assert.equal(registered.member.isAdmin, false);
  assert.match(registered.member.memberId, /^MEM/);
  ['pin', 'salt', 'hash', 'token', 'backup'].forEach(secret => assert.equal(json.includes(secret), false));
  const players = c.readTable_(c.SHEETS.PLAYERS);
  players.sheet.rows.splice(players.rows.find(r => String(r.UserId) === String(registered.member.memberId))._row - 1, 1);
  assert.throws(() => call(c, 'me', { token: registered.session.token }), /exactly one progression record/);
});

test('recovery login shares the failed-attempt window and returns safe errors', () => {
  const c = runtime();
  for (let i = 0; i < 5; i++) assert.throws(() => call(c, 'adminLogin', { secret: 'wrong' }), /Invalid/);
  assert.throws(() => call(c, 'adminLogin', { secret: 'secret' }), /Invalid/);
  const response = JSON.parse(c.doPost({ postData: { contents: JSON.stringify({ action: 'adminLogin', data: { secret: 'wrong' } }) } }).text);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INVALID_CREDENTIALS');
  assert.equal(JSON.stringify(response).includes('secret'), false);
});

test('PIN registration and login are no longer API actions', () => {
  const c = runtime();
  assert.throws(() => call(c, 'register', { characterName: 'Old Way', pin: '123456' }), /Unknown action/);
  assert.throws(() => call(c, 'login', { characterName: 'Old Way', pin: '123456' }), /Unknown action/);
});
