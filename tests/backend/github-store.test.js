const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

/** Configure GitHub storage props (never a real token) and return an admin token. */
function githubReady(c, mode = 'sheets') {
  Object.assign(c.__props, {
    GITHUB_DATA_TOKEN: 'test-token-never-real',
    GITHUB_DATA_OWNER: 'Daa13x',
    GITHUB_DATA_REPO: 'BPSR-Guild-Tracker-Data',
    GITHUB_DATA_BRANCH: 'main',
    GITHUB_DATA_PREFIX: '',
    GITHUB_DATA_MODE: mode
  });
}
function makeAdmin(c, name = 'Dax') {
  const acc = call(c, 'createAccount', { characterName: name });
  const recovery = call(c, 'adminLogin', { secret: 'secret' }).session;
  call(c, 'adminSetRole', { token: recovery.token, memberId: acc.member.memberId, isAdmin: true });
  return acc;
}

// ---- low-level GitHubStore ----

test('state paths reject traversal, escapes and non-state locations', () => {
  const c = runtime(); githubReady(c);
  assert.equal(c.ghStatePath_('state/board.json'), 'state/board.json');
  assert.throws(() => c.ghStatePath_('state/../secret.json'), /Invalid data path/);
  assert.throws(() => c.ghStatePath_('/etc/passwd'), /Invalid data path/);
  assert.throws(() => c.ghStatePath_('config/board.json'), /under state/);
  assert.throws(() => c.ghStatePath_('state//x.json'), /Invalid data path/);
  // A prefix is applied but the path still must be under state/.
  c.__props.GITHUB_DATA_PREFIX = 'env/prod';
  assert.equal(c.ghStatePath_('state/board.json'), 'env/prod/state/board.json');
});

test('private fields are rejected before any write', () => {
  const c = runtime(); githubReady(c);
  assert.throws(() => c.ghAssertNoPrivate_({ characterName: 'Dax', backupCode: 'BPSR-XXXX' }), /private field/i);
  assert.throws(() => c.ghAssertNoPrivate_({ nested: { sessionToken: 'abc' } }), /private field/i);
  assert.throws(() => c.ghAssertNoPrivate_({ tokenHash: 'x' }), /private field/i);
  // publicMemberId is explicitly allowed even though it contains "memberid".
  assert.doesNotThrow(() => c.ghAssertNoPrivate_({ publicMemberId: 'pm-abc', characterName: 'Dax', nmRaidCompleted: true }));
});

test('reads return not-exists for 404 and parsed JSON otherwise', () => {
  const c = runtime(); githubReady(c);
  const miss = c.ghReadJson_('state/board.json');
  assert.equal(miss.exists, false); assert.equal(miss.json, null); assert.equal(miss.sha, null);
  c.__github.files['state/board.json'] = JSON.stringify({ rows: [{ name: 'Dax' }] });
  const r = c.ghReadJson_('state/board.json');
  assert.equal(r.exists, true);
  assert.equal(r.json.rows[0].name, 'Dax');
});

test('commits are atomic, land the files, and never force-update the branch', () => {
  const c = runtime(); githubReady(c);
  const before = c.__github.head;
  const res = c.ghCommitFiles_([
    { rel: 'state/board.json', json: { rows: [] } },
    { rel: 'state/members/pm-1.json', json: { publicMemberId: 'pm-1', characterName: 'Dax' } }
  ], 'test commit');
  assert.ok(res.commit && res.commit !== before, 'branch advanced to the new commit');
  assert.equal(JSON.parse(c.__github.files['state/board.json']).rows.length, 0);
  assert.equal(JSON.parse(c.__github.files['state/members/pm-1.json']).characterName, 'Dax');
  // Every ref update was force:false.
  assert.ok(c.__github.refUpdates.length >= 1);
  c.__github.refUpdates.forEach(u => assert.equal(u.force, false, 'force must be false'));
});

test('a transient non-fast-forward conflict is retried and then succeeds', () => {
  const c = runtime(); githubReady(c);
  c.__github.conflictOnce = true;
  const res = c.ghCommitFiles_([{ rel: 'state/manifest.json', json: { ok: true } }], 'retry');
  assert.ok(res.commit);
  assert.ok(res.attempts >= 2, 'took at least two attempts');
  assert.equal(JSON.parse(c.__github.files['state/manifest.json']).ok, true);
});

test('an unresolvable conflict throws and writes nothing', () => {
  const c = runtime(); githubReady(c);
  c.__github.fail = 422;   // every ref update is a conflict
  const headBefore = c.__github.head;
  assert.throws(() => c.ghCommitFiles_([{ rel: 'state/board.json', json: { rows: [] } }]), /newer changes|not.*applied/i);
  assert.equal(c.__github.head, headBefore, 'branch head unchanged after failed write');
  assert.equal('state/board.json' in c.__github.files, false, 'no partial file written');
});

test('the token never appears in status or error messages', () => {
  const c = runtime(); githubReady(c);
  const status = c.ghSafeStatus_();
  assert.equal(status.hasToken, true);
  assert.equal('token' in status, false, 'status must not carry the token value');
  assert.equal(JSON.stringify(status).includes('test-token-never-real'), false);
  c.__github.fail = 'ref500';
  try { c.ghCommitFiles_([{ rel: 'state/board.json', json: {} }]); assert.fail('should throw'); }
  catch (e) { assert.equal(String(e.message).includes('test-token-never-real'), false, 'token must never be in an error'); }
});

// ---- migration actions ----

test('migration preview is admin-only and changes nothing', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  const other = call(c, 'createAccount', { characterName: 'Aria' });
  assert.throws(() => call(c, 'previewGithubMigration', { token: other.session.token }), /Administrator|admin/i);
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  assert.ok(preview.confirmToken);
  assert.equal(typeof preview.memberCount, 'number');
  assert.equal(Object.keys(c.__github.files).length, 0, 'preview writes nothing to GitHub');
});

test('execute requires a preview token, writes one atomic commit, and verify passes', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  // Give the admin some progression incl. a legacy combined raid.
  call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 40 },
    difficulty: { easy: true, hard: false, nmRaidCompleted: false, easyHardRaidCompleted: true, master: false } });

  assert.throws(() => call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: 'wrong' }), /preview/i);
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  const commitsBefore = c.__github.seq;
  const exec = call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  assert.ok(exec.commit);
  // Exactly one branch advance (one atomic commit), not one-per-member.
  assert.equal(c.__github.refUpdates.filter(u => u.force === false).length, 1);
  assert.ok('state/board.json' in c.__github.files);
  const memberFiles = Object.keys(c.__github.files).filter(k => k.startsWith('state/members/'));
  assert.ok(memberFiles.length >= 1);

  const verify = call(c, 'verifyGithubMigration', { token: admin.session.token });
  assert.equal(verify.pass, true, JSON.stringify(verify.problems));
});

test('member files carry the separated raid fields and never private data', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {},
    difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: false, master: false } });
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  const file = JSON.parse(Object.entries(c.__github.files).find(([k]) => k.startsWith('state/members/'))[1]);
  assert.equal(typeof file.nmRaidCompleted, 'boolean');
  assert.equal(typeof file.easyHardRaidCompleted, 'boolean');
  assert.ok(file.publicMemberId.startsWith('pm-'), 'uses a public id');
  // No private identifiers or secrets anywhere in the stored file.
  const json = JSON.stringify(file).toLowerCase();
  ['backupcode', 'sessiontoken', 'tokenhash', 'pinhash', 'privatememberid', 'email'].forEach(k =>
    assert.equal(json.includes(k), false, k + ' must not be stored'));
  assert.equal(json.includes(admin.member.memberId.toLowerCase()), false, 'private member id not stored');
});

test('legacy combined raid migrates to Easy/Hard only, NM defaults false', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  // Simulate a pre-split Players row: legacy RaidComplete true, no NM/EH.
  const t = c.readTable_('Players'); const row = t.rows.filter(r => String(r.UserId) === admin.member.memberId)[0];
  t.sheet.getRange(row._row, t.headers.indexOf('RaidComplete') + 1).setValue(true);
  t.sheet.getRange(row._row, t.headers.indexOf('EHRaidComplete') + 1).setValue('');
  t.sheet.getRange(row._row, t.headers.indexOf('NMRaidComplete') + 1).setValue('');
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  const file = JSON.parse(Object.entries(c.__github.files).find(([k]) => k.startsWith('state/members/'))[1]);
  assert.equal(file.easyHardRaidCompleted, true, 'legacy raid -> Easy/Hard');
  assert.equal(file.nmRaidCompleted, false, 'NM never copied from legacy raid');
});

// ---- storage modes ----

test('github mode reads the board from GitHub and never from the Sheets progression tables', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 30 },
    difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: false, master: false } });
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  call(c, 'verifyGithubMigration', { token: admin.session.token });
  call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'github' });

  // Spy: any progression sheet read in github mode is a failure.
  const realRead = c.readTable_;
  c.readTable_ = function (name) {
    if (name === 'Players' || name === c.MASTER_SEAL_SHEET) throw new Error('github mode read progression from Sheets: ' + name);
    return realRead(name);
  };
  let board;
  try { board = call(c, 'masterSeal', { token: admin.session.token }); }
  finally { c.readTable_ = realRead; }
  assert.ok(board.board.length >= 1, 'board served from GitHub');
  assert.equal(board.board[0].nmRaid, true);
});

test('github mode surfaces GitHub failures honestly and never falls back to Sheets', () => {
  const c = runtime(); githubReady(c, 'github');   // github mode but nothing migrated
  const admin = makeAdmin(c);
  assert.throws(() => call(c, 'masterSeal', { token: admin.session.token }), /not been migrated|GitHub/i);
});

test('mode switching is admin-gated and github mode requires a passed verification', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  const other = call(c, 'createAccount', { characterName: 'Aria' });
  assert.throws(() => call(c, 'switchGithubStorageMode', { token: other.session.token, mode: 'shadow' }), /Administrator|admin/i);
  assert.throws(() => call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'nonsense' }), /sheets, shadow or github/);
  // github mode blocked until verification passes.
  assert.throws(() => call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'github' }), /Verification/i);
  // shadow is allowed without verification.
  assert.equal(call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'shadow' }).mode, 'shadow');
});

test('getGithubStorageStatus reports mode and never leaks the token', () => {
  const c = runtime(); githubReady(c, 'shadow');
  const admin = makeAdmin(c);
  const status = call(c, 'getGithubStorageStatus', { token: admin.session.token });
  assert.equal(status.mode, 'shadow');
  assert.equal(status.hasToken, true);
  assert.equal(JSON.stringify(status).includes('test-token-never-real'), false);
  assert.equal(status.repo, 'BPSR-Guild-Tracker-Data');
});

test('the public member id is stable and its private mapping stays in Sheets', () => {
  const c = runtime(); githubReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const p1 = c.publicIdFor_(dax.member.memberId);
  const p2 = c.publicIdFor_(dax.member.memberId);
  assert.equal(p1, p2, 'stable public id');
  assert.equal(c.memberIdForPublic_(p1), dax.member.memberId, 'reverse mapping only in Sheets');
  // The mapping sheet is private (it holds the real member id) and never committed.
  assert.ok(c.__sheets.MemberMap.rows.length >= 1);
});

// ---- github-mode normal saves ----

test('github mode saves progression to GitHub (member + board) and never to Sheets', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  call(c, 'verifyGithubMigration', { token: admin.session.token });
  call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'github' });

  const realRead = c.readTable_, realWrite = c.writePlayerRow_;
  c.readTable_ = (n) => { if (n === 'Players' || n === c.MASTER_SEAL_SHEET) throw new Error('read progression from Sheets: ' + n); return realRead(n); };
  c.writePlayerRow_ = () => { throw new Error('wrote progression to Sheets in github mode'); };
  let res;
  try {
    res = call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 52 },
      difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: false, master: false } });
  } finally { c.readTable_ = realRead; c.writePlayerRow_ = realWrite; }
  assert.equal(res.stimVault.points, 52);
  assert.equal(res.difficulty.nmRaidCompleted, true);
  assert.equal(res.difficulty.easyHardRaidCompleted, false);
  // Persisted to GitHub and reloadable.
  const reload = call(c, 'myMasterSeal', { token: admin.session.token });
  assert.equal(reload.stimVault.points, 52);
  assert.equal(reload.difficulty.nmRaidCompleted, true);
});

test('github mode raid + Stim Vault resets use period ids and fire once', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  const preview = call(c, 'previewGithubMigration', { token: admin.session.token });
  call(c, 'executeGithubMigration', { token: admin.session.token, confirmToken: preview.confirmToken });
  call(c, 'verifyGithubMigration', { token: admin.session.token });
  call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'github' });
  call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 40 },
    difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: true, master: false } });
  // Force a stale reset period on the stored file.
  const publicId = c.publicIdFor_(admin.member.memberId);
  const file = JSON.parse(c.__github.files['state/members/' + publicId + '.json']);
  file.raidResetPeriod = 'OLD-PERIOD'; file.stimVaultResetPeriod = 'OLD-PERIOD';
  c.__github.files['state/members/' + publicId + '.json'] = JSON.stringify(file);
  const reloaded = call(c, 'myMasterSeal', { token: admin.session.token });
  assert.equal(reloaded.difficulty.nmRaidCompleted, false, 'weekly raid reset cleared NM');
  assert.equal(reloaded.difficulty.easyHardRaidCompleted, false, 'weekly raid reset cleared Easy/Hard');
  assert.equal(reloaded.stimVault.points, 0, 'biweekly Stim Vault reset cleared floors');
  // Second load in the same period does not reset again (idempotent) and holds a new value.
  call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 12 },
    difficulty: { easy: false, hard: false, nmRaidCompleted: false, easyHardRaidCompleted: false, master: false } });
  assert.equal(call(c, 'myMasterSeal', { token: admin.session.token }).stimVault.points, 12);
});

test('shadow mode writes to GitHub in addition to Sheets and reports failures honestly', () => {
  const c = runtime(); githubReady(c);
  const admin = makeAdmin(c);
  call(c, 'switchGithubStorageMode', { token: admin.session.token, mode: 'shadow' });
  const res = call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 15 },
    difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: false, master: false } });
  // Sheets remains authoritative (existing return shape) …
  assert.equal(res.stimVault.points, 15);
  // … and the member was mirrored to GitHub.
  const publicId = c.publicIdFor_(admin.member.memberId);
  assert.ok('state/members/' + publicId + '.json' in c.__github.files, 'shadow mirrored the member to GitHub');
  assert.equal(res.shadowError, undefined);
  // A GitHub failure is surfaced, never silently swallowed.
  c.__github.fail = 'network';
  const res2 = call(c, 'masterSealUpdate', { token: admin.session.token, dungeons: {}, stimVault: { points: 16 },
    difficulty: { easy: false, hard: false, nmRaidCompleted: true, easyHardRaidCompleted: false, master: false } });
  assert.ok(res2.shadowError, 'shadow GitHub failure is reported');
});
