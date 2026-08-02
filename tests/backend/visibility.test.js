const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

/** Promote Dax to admin and return a usable admin token + a second member. */
function guild(c) {
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const aria = call(c, 'createAccount', { characterName: 'Aria' });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: dax.member.memberId, isAdmin: true });
  // Give both a visible SV floor so they land on the SV board.
  call(c, 'progress', { token: dax.session.token, svFloor: 40, masterRanks: {} });
  call(c, 'progress', { token: aria.session.token, svFloor: 30, masterRanks: {} });
  return { dax, aria, adminToken: dax.session.token };
}

test('hiding a member removes them for everyone else but not for themselves', () => {
  const c = runtime();
  const { dax, aria, adminToken } = guild(c);

  // Both visible to an anonymous viewer at first.
  let anon = call(c, 'leaderboard', {});
  assert.deepEqual(anon.svBoard.map(r => r.name).sort(), ['Aria', 'Dax']);

  call(c, 'adminSetHidden', { token: adminToken, memberId: aria.member.memberId, hidden: true });

  // Anonymous viewer no longer sees Aria.
  anon = call(c, 'leaderboard', {});
  assert.deepEqual(anon.svBoard.map(r => r.name), ['Dax']);
  assert.equal(anon.svBoard.some(r => r.hidden), false, 'no hidden flag leaks to others');

  // Dax (another member) does not see Aria either.
  const asDax = call(c, 'leaderboard', { token: adminToken });
  assert.equal(asDax.svBoard.some(r => r.name === 'Aria'), false);

  // Aria still sees her own row, flagged, and her real rank is preserved.
  const asAria = call(c, 'leaderboard', { token: aria.session.token });
  const ariaRow = asAria.svBoard.filter(r => r.name === 'Aria')[0];
  assert.ok(ariaRow, 'a hidden member sees her own row');
  assert.equal(ariaRow.hidden, true);
  assert.equal(asAria.viewerHidden, true);

  // Unhiding restores her for everyone.
  call(c, 'adminSetHidden', { token: adminToken, memberId: aria.member.memberId, hidden: false });
  assert.deepEqual(call(c, 'leaderboard', {}).svBoard.map(r => r.name).sort(), ['Aria', 'Dax']);
});

test('a hidden member is absent from the Master Seal board for others, present for self', () => {
  const c = runtime();
  const { aria, adminToken } = guild(c);
  call(c, 'adminSetHidden', { token: adminToken, memberId: aria.member.memberId, hidden: true });

  const others = call(c, 'masterSeal', {});
  assert.equal(others.board.some(r => r.name === 'Aria'), false);

  const self = call(c, 'masterSeal', { token: aria.session.token });
  const row = self.board.filter(r => r.name === 'Aria')[0];
  assert.ok(row);
  assert.equal(row.hidden, true);
});

test('the verified mark is public and toggled by admins', () => {
  const c = runtime();
  const { aria, adminToken } = guild(c);

  assert.equal(call(c, 'leaderboard', {}).svBoard.filter(r => r.name === 'Aria')[0].verified, false);
  call(c, 'adminSetVerified', { token: adminToken, memberId: aria.member.memberId, verified: true });

  // Verified shows for everyone, including anonymous viewers.
  assert.equal(call(c, 'leaderboard', {}).svBoard.filter(r => r.name === 'Aria')[0].verified, true);
  assert.equal(call(c, 'masterSeal', {}).board.filter(r => r.name === 'Aria')[0].verified, true);

  call(c, 'adminSetVerified', { token: adminToken, memberId: aria.member.memberId, verified: false });
  assert.equal(call(c, 'leaderboard', {}).svBoard.filter(r => r.name === 'Aria')[0].verified, false);
});

test('hidden and verified require admin rights and boolean input', () => {
  const c = runtime();
  const { aria, dax } = guild(c);
  // A non-admin member cannot hide or verify anyone.
  assert.throws(() => call(c, 'adminSetHidden', { token: aria.session.token, memberId: dax.member.memberId, hidden: true }));
  assert.throws(() => call(c, 'adminSetVerified', { token: aria.session.token, memberId: dax.member.memberId, verified: true }));
  // Non-boolean input is rejected.
  assert.throws(() => call(c, 'adminSetHidden', { token: dax.session.token, memberId: aria.member.memberId, hidden: 'yes' }), /true or false/);
  assert.throws(() => call(c, 'adminSetVerified', { token: dax.session.token, memberId: aria.member.memberId, verified: 1 }), /true or false/);
});

test('admin views report each member current visibility and verified state', () => {
  const c = runtime();
  const { aria, adminToken } = guild(c);
  call(c, 'adminSetHidden', { token: adminToken, memberId: aria.member.memberId, hidden: true });
  call(c, 'adminSetVerified', { token: adminToken, memberId: aria.member.memberId, verified: true });
  const read = call(c, 'adminRead', { token: adminToken, memberId: aria.member.memberId });
  assert.equal(read.hidden, true);
  assert.equal(read.verified, true);
  const listed = call(c, 'adminMembers', { token: adminToken, query: 'Aria' })[0];
  assert.equal(listed.hidden, true);
  assert.equal(listed.verified, true);
});
