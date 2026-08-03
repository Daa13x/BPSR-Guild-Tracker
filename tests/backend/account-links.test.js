const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

function accounts(c) {
  const main = call(c, 'createAccount', { characterName: 'Main Paw' });
  const alt = call(c, 'createAccount', { characterName: 'Alt Paw' });
  const other = call(c, 'createAccount', { characterName: 'Other Paw' });
  return { main, alt, other };
}

test('a main account links an existing alt once and can switch its active profile', () => {
  const c = runtime();
  const { main, alt } = accounts(c);
  const preview = call(c, 'previewAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  assert.equal(preview.memberId, alt.member.memberId);
  assert.equal(preview.characterName, 'Alt Paw');
  const linked = call(c, 'linkAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  assert.equal(linked.accounts.length, 2);
  assert.equal(linked.accounts[0].isMain, true);
  assert.equal(linked.accounts[1].characterName, 'Alt Paw');
  // Idempotent: no duplicate relationship row is created.
  call(c, 'linkAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  assert.equal(c.readTable_(c.AUTH_SHEETS.LINKS).rows.filter(r => !r.UnlinkedAt).length, 1);
  const switched = call(c, 'switchActiveAccount', { token: main.session.token, memberId: alt.member.memberId });
  assert.equal(switched.member.characterName, 'Alt Paw');
  assert.equal(call(c, 'me', { token: main.session.token }).characterName, 'Alt Paw');
  assert.equal(call(c, 'refresh', { token: main.session.token, kind: 'member' }).profile.characterName, 'Alt Paw');
});

test('a main account can create and link a fresh secondary character without switching away', () => {
  const c = runtime();
  const main = call(c, 'createAccount', { characterName: 'Main Paw' });
  const created = call(c, 'createAltAccount', { token: main.session.token, characterName: 'Fresh Alt' });
  assert.equal(created.account.characterName, 'Fresh Alt');
  assert.match(created.backupCode, /^BPSR-/);
  assert.equal(created.accounts.activeMemberId, main.member.memberId);
  assert.equal(created.accounts.accounts.length, 2);
  assert.equal(c.readTable_(c.AUTH_SHEETS.LINKS).rows.filter(r => !r.UnlinkedAt).length, 1);
  assert.throws(() => call(c, 'createAltAccount', { token: main.session.token, characterName: 'Fresh Alt' }), /already has an account/);
});

test('linked account checks reject invalid codes, self links, other mains and unrelated ids', () => {
  const c = runtime();
  const { main, alt, other } = accounts(c);
  assert.throws(() => call(c, 'linkAltAccount', { token: main.session.token, backupCode: 'BPSR-NOPE-NOPE-NOPE' }), /incorrect/);
  assert.throws(() => call(c, 'linkAltAccount', { token: main.session.token, backupCode: main.backupCode }), /itself/);
  call(c, 'linkAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  assert.throws(() => call(c, 'switchActiveAccount', { token: main.session.token, memberId: other.member.memberId }), /not available/);
  // The linked alt cannot become a second main's alt or enumerate siblings.
  assert.throws(() => call(c, 'linkAltAccount', { token: other.session.token, backupCode: alt.backupCode }), /already linked/);
  const altOnly = call(c, 'restore', { characterName: 'Alt Paw', backupCode: alt.backupCode });
  const list = call(c, 'listAccessibleAccounts', { token: altOnly.session.token });
  assert.equal(list.canManage, false);
  assert.equal(list.accounts.length, 1);
  assert.equal(list.accounts[0].memberId, alt.member.memberId);
  assert.throws(() => call(c, 'switchActiveAccount', { token: altOnly.session.token, memberId: main.member.memberId }), /not available/);
  assert.throws(() => call(c, 'linkAltAccount', { token: altOnly.session.token, backupCode: other.backupCode }), /Only the main/);
});

test('account-scoped writes use the active alt and unlink safely removes only group access', () => {
  const c = runtime();
  const { main, alt } = accounts(c);
  call(c, 'linkAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  call(c, 'switchActiveAccount', { token: main.session.token, memberId: alt.member.memberId });
  call(c, 'progress', { token: main.session.token, svFloor: 7 });
  assert.equal(call(c, 'me', { token: main.session.token }).svFloor, 7);
  call(c, 'switchActiveAccount', { token: main.session.token, memberId: main.member.memberId });
  assert.equal(call(c, 'me', { token: main.session.token }).svFloor, 0);
  call(c, 'switchActiveAccount', { token: main.session.token, memberId: alt.member.memberId });
  const unlinked = call(c, 'unlinkAltAccount', { token: main.session.token, memberId: alt.member.memberId });
  assert.equal(unlinked.activeMemberId, main.member.memberId);
  assert.equal(unlinked.accounts.length, 1);
  // The account and its progress remain independently recoverable.
  const altOnly = call(c, 'restore', { characterName: 'Alt Paw', backupCode: alt.backupCode });
  assert.equal(call(c, 'me', { token: altOnly.session.token }).svFloor, 7);
});
