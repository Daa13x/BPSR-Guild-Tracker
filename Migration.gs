/**
 * Migration.gs — the GitHub-backed data model, storage modes, and the
 * admin-only migration/verification actions.
 *
 * NON-PRIVATE tracker data (profiles, classes, Stim Vault, Master Seal,
 * NM/Easy-Hard raid, scores, board, reset periods) lives in `state/…` in the
 * private data repo. PRIVATE security data (accounts, sessions, backup codes,
 * throttling, admin permissions, the privateMemberId→publicMemberId mapping)
 * stays in Google Sheets and never reaches GitHub.
 */

var GH_SCHEMA_VERSION = 1;
var MEMBER_MAP_SHEET = 'MemberMap';                 // PRIVATE: memberId -> publicMemberId
var MEMBER_MAP_HEADERS = ['MemberId', 'PublicMemberId', 'CreatedAt'];
var GH_MIGRATION_SHEET = 'GithubMigration';         // PRIVATE: preview tokens + audit
var GH_MIGRATION_HEADERS = ['Key', 'Value', 'UpdatedAt'];

function ensureMemberMapSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, MEMBER_MAP_SHEET, MEMBER_MAP_HEADERS);
  ensureColumns_(ss.getSheetByName(MEMBER_MAP_SHEET), MEMBER_MAP_HEADERS);
  ensureSheet_(ss, GH_MIGRATION_SHEET, GH_MIGRATION_HEADERS);
  ensureColumns_(ss.getSheetByName(GH_MIGRATION_SHEET), GH_MIGRATION_HEADERS);
}

/** Stable, non-reversible public id for a member. The mapping is private. */
function publicIdFor_(memberId) {
  ensureMemberMapSheet_();
  var t = readTable_(MEMBER_MAP_SHEET);
  var existing = t.rows.filter(function (r) { return String(r.MemberId) === String(memberId); })[0];
  if (existing && existing.PublicMemberId) return String(existing.PublicMemberId);
  // Derived from a hash so it never exposes the private id, and is stable.
  var digest = hash_('pmid:' + String(memberId)).slice(0, 16);
  var publicId = 'pm-' + digest;
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MEMBER_MAP_SHEET).appendRow([String(memberId), publicId, new Date()]);
  return publicId;
}
function memberIdForPublic_(publicId) {
  ensureMemberMapSheet_();
  var r = readTable_(MEMBER_MAP_SHEET).rows.filter(function (x) { return String(x.PublicMemberId) === String(publicId); })[0];
  return r ? String(r.MemberId) : null;
}

// --- reset-period identifiers (id-based so a reset applies exactly once) ---
function stimPeriodId_(now) { var b = lastStimReset_(now || new Date(), stimAnchor_()); return b ? b.toISOString() : ''; }
function raidPeriodId_(now) { var b = lastRaidReset_(now || new Date(), stimAnchor_()); return b ? b.toISOString() : ''; }

/** Build the non-private member file from the current Sheets data. */
function buildMemberFile_(memberRow, ctx) {
  var memberId = String(memberRow.MemberId);
  var player = ctx.playersById[memberId] || null;
  var dungeons = sealProgress_(ctx.sealByMember[memberId]);
  var raid = player ? raidState_(player) : { nm: false, easyHard: false };
  var floor = player ? masterSealSvFloor_(player.SVFloor) : 0;
  return {
    schemaVersion: GH_SCHEMA_VERSION,
    publicMemberId: publicIdFor_(memberId),
    characterName: String(memberRow.CharacterName || ''),
    profile: {
      verified: player ? truthy_(player.Verified) : false,
      hidden: player ? truthy_(player.Hidden) : false,
      disabled: Boolean(memberRow.DisabledAt)
    },
    classes: (ctx.classesByMember[memberId] || []).map(function (x) { return { classId: String(x.classId), buildId: String(x.buildId) }; }),
    stimVault: { floors: floor },
    masterSeal: {
      dungeons: dungeons.map(function (d) { return { dungeonId: d.dungeonId, bestMasterLevel: d.bestMasterLevel, points: d.points, cleared: d.cleared }; })
    },
    difficulty: {
      easy: player ? truthy_(player.EasyComplete) : false,
      hard: player ? truthy_(player.HardComplete) : false,
      master: player ? truthy_(player.MasterComplete) : false
    },
    nmRaidCompleted: Boolean(raid.nm),
    easyHardRaidCompleted: Boolean(raid.easyHard),
    raidResetPeriod: raidPeriodId_(),
    stimVaultResetPeriod: stimPeriodId_(),
    updatedAt: player && player.LastUpdated ? iso_(player.LastUpdated) : iso_(new Date()),
    dataRevision: 1
  };
}

/** Server-calculated board row from a member file. Never trusts client totals. */
function boardRowFromMember_(file) {
  var dungeons = (file.masterSeal && file.masterSeal.dungeons) || [];
  var totals = sealTotals_(dungeons.map(function (d) {
    return { dungeonId: d.dungeonId, bestMasterLevel: d.bestMasterLevel, points: Number(d.points) || 0, cleared: Boolean(d.cleared), updatedAt: null };
  }));
  return {
    publicMemberId: file.publicMemberId,
    name: file.characterName,
    verified: file.profile ? Boolean(file.profile.verified) : false,
    hidden: file.profile ? Boolean(file.profile.hidden) : false,
    classes: file.classes || [],
    svFloor: file.stimVault ? (Number(file.stimVault.floors) || 0) : 0,
    nmRaid: Boolean(file.nmRaidCompleted),
    easyHardRaid: Boolean(file.easyHardRaidCompleted),
    dungeons: dungeons,
    totalScore: totals.totalScore,
    remainingScore: totals.remainingScore,
    progressPercent: totals.progressPercent,
    clearedCount: totals.clearedCount,
    mountUnlocked: totals.mountUnlocked,
    lastUpdated: file.updatedAt || null
  };
}

/** Build board.json from all member files (ranked, server-scored). */
function buildBoardFile_(memberFiles) {
  var rows = memberFiles.filter(function (f) { return !(f.profile && f.profile.disabled); }).map(boardRowFromMember_);
  rows.sort(function (a, b) { return (b.totalScore - a.totalScore) || String(a.name).localeCompare(String(b.name)); });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return { schemaVersion: GH_SCHEMA_VERSION, generatedAt: iso_(new Date()), season: sealSeasonPublic_(), rows: rows };
}

/** Build one member's file from the current Sheets data. */
function buildSingleMemberFile_(memberId) {
  var ctx = { playersById: {}, sealByMember: sealRowsByMember_(), classesByMember: classEntriesByMember_() };
  readTable_(SHEETS.PLAYERS).rows.forEach(function (p) { ctx.playersById[String(p.UserId)] = p; });
  var m = member_(memberId);
  if (!m) throw apiError_('NOT_FOUND', 'Member not found.');
  return buildMemberFile_(m, ctx);
}

/** Shadow mode: mirror one member (and their board row) to GitHub after the
 * authoritative Sheets write. Sheets stays the source of truth; GitHub is a
 * comparison mirror. Throws honestly if GitHub rejects the write. */
function shadowMirrorMember_(memberId) {
  var file = buildSingleMemberFile_(memberId);
  ghCommitFiles_([
    { rel: 'state/members/' + file.publicMemberId + '.json', json: file },
    { rel: 'state/board.json', json: githubBoardWithMember_(file) }
  ], 'Shadow mirror ' + file.publicMemberId);
  return { mirrored: true };
}

/** Assemble the entire non-private dataset from the current Sheets source. */
function buildDataset_() {
  var ctx = {
    playersById: {},
    sealByMember: sealRowsByMember_(),
    classesByMember: classEntriesByMember_()
  };
  readTable_(SHEETS.PLAYERS).rows.forEach(function (p) { ctx.playersById[String(p.UserId)] = p; });
  var members = readTable_(AUTH_SHEETS.MEMBERS).rows;
  var files = members.map(function (m) { return buildMemberFile_(m, ctx); });
  var board = buildBoardFile_(files);
  var manifest = {
    schemaVersion: GH_SCHEMA_VERSION, generatedAt: iso_(new Date()),
    memberCount: files.length, board: 'state/board.json'
  };
  var schema = {
    schemaVersion: GH_SCHEMA_VERSION,
    describes: 'OnlyPaws Tracker non-private state',
    memberFields: ['schemaVersion', 'publicMemberId', 'characterName', 'profile', 'classes', 'stimVault', 'masterSeal', 'nmRaidCompleted', 'easyHardRaidCompleted', 'raidResetPeriod', 'stimVaultResetPeriod', 'updatedAt', 'dataRevision']
  };
  return { files: files, board: board, manifest: manifest, schema: schema, ctx: ctx };
}

/** Convert a dataset into the list of GitHub files for a single atomic commit. */
function datasetCommitFiles_(dataset) {
  var out = [
    { rel: 'state/schema.json', json: dataset.schema },
    { rel: 'state/manifest.json', json: dataset.manifest },
    { rel: 'state/board.json', json: dataset.board }
  ];
  dataset.files.forEach(function (f) { out.push({ rel: 'state/members/' + f.publicMemberId + '.json', json: f }); });
  return out;
}

// -------------------------------------------------------------------------
// Storage-mode-aware read paths (github/shadow read from GitHub)
// -------------------------------------------------------------------------

/** The raw board.json from GitHub (github mode only), with a short cache. */
function githubBoardOrNull_() {
  if (storageMode_() !== 'github') return null;
  var cached = ghCacheGet_('board');
  if (cached) return cached;
  var read = ghReadJson_('state/board.json');
  if (!read.exists) throw apiError_('GITHUB', 'The board has not been migrated to GitHub yet.');
  ghCachePut_('board', read.json, 45);
  return read.json;
}

/**
 * The Master Seal board in github mode — read entirely from GitHub, never from
 * the Sheets progression tables. Only the private publicMemberId mapping is
 * read from Sheets, to let a hidden member still see their own row.
 */
function githubMasterSealBoard_(viewerMemberId) {
  var board = githubBoardOrNull_();
  var viewerPublic = viewerMemberId ? publicIdFor_(viewerMemberId) : '';
  var rows = (board.rows || []).filter(function (r) { return !r.hidden || (viewerPublic && r.publicMemberId === viewerPublic); });
  return { season: board.season || sealSeasonPublic_(), board: rows, generatedAt: board.generatedAt };
}

// -------------------------------------------------------------------------
// GitHub-mode member read / write (normal saves)
// -------------------------------------------------------------------------

var GH_SEASON_MAX = 3650;

/** Read a member's GitHub file, or a fresh empty one keyed to their public id. */
function githubReadMemberFile_(memberId) {
  var publicId = publicIdFor_(memberId);
  var read = ghReadJson_('state/members/' + publicId + '.json');
  if (read.exists && read.json) { read.json.publicMemberId = publicId; return { file: read.json, existed: true }; }
  return {
    file: {
      schemaVersion: GH_SCHEMA_VERSION, publicMemberId: publicId, characterName: '',
      profile: { verified: false, hidden: false, disabled: false }, classes: [],
      stimVault: { floors: 0 }, masterSeal: { dungeons: [] },
      difficulty: { easy: false, hard: false, master: false },
      nmRaidCompleted: false, easyHardRaidCompleted: false,
      raidResetPeriod: raidPeriodId_(), stimVaultResetPeriod: stimPeriodId_(),
      updatedAt: iso_(new Date()), dataRevision: 0
    }, existed: false
  };
}

/** Apply id-based resets in place. Raid clears weekly; Stim Vault clears
 * biweekly — each only when its stored period id differs from the current one,
 * so the same reset never fires twice. Returns whether anything changed. */
function githubApplyResets_(file) {
  var changed = false;
  var raidPeriod = raidPeriodId_(), stimPeriod = stimPeriodId_();
  if (String(file.raidResetPeriod || '') !== raidPeriod) {
    if (file.nmRaidCompleted || file.easyHardRaidCompleted) changed = true;
    file.nmRaidCompleted = false; file.easyHardRaidCompleted = false;
    file.raidResetPeriod = raidPeriod;
    if (file.raidResetPeriod !== undefined) changed = changed || true;
  }
  if (String(file.stimVaultResetPeriod || '') !== stimPeriod) {
    if (file.stimVault && Number(file.stimVault.floors) > 0) changed = true;
    file.stimVault = file.stimVault || {}; file.stimVault.floors = 0;
    file.stimVaultResetPeriod = stimPeriod;
    changed = changed || true;
  }
  return changed;
}

/** Rebuild board.json with one member row replaced/inserted and re-ranked. */
function githubBoardWithMember_(memberFile) {
  var read = ghReadJson_('state/board.json');
  var board = read.exists && read.json ? read.json : { schemaVersion: GH_SCHEMA_VERSION, season: sealSeasonPublic_(), rows: [] };
  var rows = (board.rows || []).filter(function (r) { return r.publicMemberId !== memberFile.publicMemberId; });
  if (!(memberFile.profile && memberFile.profile.disabled)) rows.push(boardRowFromMember_(memberFile));
  rows.sort(function (a, b) { return (b.totalScore - a.totalScore) || String(a.name).localeCompare(String(b.name)); });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  board.rows = rows; board.generatedAt = iso_(new Date()); board.season = board.season || sealSeasonPublic_();
  return board;
}

function githubDifficultyPublic_(file) {
  return {
    easy: Boolean(file.difficulty && file.difficulty.easy),
    hard: Boolean(file.difficulty && file.difficulty.hard),
    nmRaidCompleted: Boolean(file.nmRaidCompleted),
    easyHardRaidCompleted: Boolean(file.easyHardRaidCompleted),
    master: Boolean(file.difficulty && file.difficulty.master)
  };
}

function githubStimPublic_(file, boundaryNextIso) {
  return {
    id: 'stim-vault', name: 'Stim Vault', points: file.stimVault ? (Number(file.stimVault.floors) || 0) : 0,
    bestMasterLevel: null, max: SV_MAX_FLOOR, enabled: stimResetEnabled_(),
    periodStart: file.stimVaultResetPeriod || null, nextResetAt: boundaryNextIso
  };
}

/** myMasterSeal in github mode: read the member file, apply resets (committing
 * only the member + board when something reset), and return the editor shape. */
function githubMyMasterSeal_(memberId) {
  var r = githubReadMemberFile_(memberId);
  var file = r.file;
  if (githubApplyResets_(file) && r.existed) {
    file.updatedAt = iso_(new Date()); file.dataRevision = (Number(file.dataRevision) || 0) + 1;
    ghCommitFiles_([
      { rel: 'state/members/' + file.publicMemberId + '.json', json: file },
      { rel: 'state/board.json', json: githubBoardWithMember_(file) }
    ], 'Apply resets for ' + file.publicMemberId);
  }
  var stimBoundary = lastStimReset_(new Date(), stimAnchor_());
  var next = stimBoundary ? new Date(stimBoundary.getTime() + STIM_RESET_PERIOD_MS).toISOString() : null;
  var dungeons = sealProgress_(githubDungeonRows_(file));
  return {
    season: sealSeasonPublic_(), dungeons: dungeons, totals: sealTotals_(dungeons),
    stimVault: githubStimPublic_(file, next), difficulty: githubDifficultyPublic_(file)
  };
}

/** Convert stored member dungeons into the sealProgress_ input shape. */
function githubDungeonRows_(file) {
  var byId = {};
  ((file.masterSeal && file.masterSeal.dungeons) || []).forEach(function (d) {
    byId[String(d.dungeonId)] = { BestMasterLevel: d.bestMasterLevel, Points: d.points, Cleared: d.cleared, UpdatedAt: null };
  });
  return byId;
}

/** masterSealUpdate in github mode: validate, edit only own file, recompute,
 * regenerate the board, and commit member + board atomically. Returns after
 * GitHub confirms the commit. Never trusts client-sent scores. */
function githubMasterSealUpdate_(memberId, d) {
  var r = githubReadMemberFile_(memberId);
  var file = r.file;
  githubApplyResets_(file);
  // Keep the display name current from the private account record.
  var m = member_(memberId); if (m) file.characterName = String(m.CharacterName || file.characterName);

  // Dungeons (validated the same way as the Sheets path).
  if (d.dungeons && typeof d.dungeons === 'object') {
    var validated = {};
    Object.keys(d.dungeons).forEach(function (id) { validated[id] = sealValidateEntry_(id, d.dungeons[id]); });
    var existing = {}; ((file.masterSeal && file.masterSeal.dungeons) || []).forEach(function (x) { existing[String(x.dungeonId)] = x; });
    Object.keys(validated).forEach(function (id) {
      var e = validated[id];
      existing[id] = { dungeonId: id, bestMasterLevel: e.bestMasterLevel, points: e.points, cleared: e.cleared };
    });
    file.masterSeal = { dungeons: MASTER_SEAL_SEASON.dungeons.map(function (def) { return existing[def.id] || { dungeonId: def.id, bestMasterLevel: null, points: 0, cleared: false }; }) };
  }
  // Stim Vault floor (0..SV_MAX_FLOOR).
  if (d.stimVault && d.stimVault.points !== undefined && d.stimVault.points !== null && d.stimVault.points !== '') {
    file.stimVault = { floors: integer_(d.stimVault.points, 0, SV_MAX_FLOOR) };
    file.stimVaultResetPeriod = stimPeriodId_();
  }
  // Difficulty incl. the two independent raids.
  if (d.difficulty) {
    var dd = d.difficulty;
    if (typeof dd.easy !== 'boolean' || typeof dd.hard !== 'boolean' || typeof dd.nmRaidCompleted !== 'boolean' ||
        typeof dd.easyHardRaidCompleted !== 'boolean' || typeof dd.master !== 'boolean') {
      throw apiError_('VALIDATION', 'Easy, Hard, NM Raid, Easy/Hard Raid and Master completion values must be true or false.');
    }
    file.difficulty = { easy: dd.easy, hard: dd.hard, master: dd.master };
    file.nmRaidCompleted = dd.nmRaidCompleted;
    file.easyHardRaidCompleted = dd.easyHardRaidCompleted;
    file.raidResetPeriod = raidPeriodId_();
  }
  file.updatedAt = iso_(new Date());
  file.dataRevision = (Number(file.dataRevision) || 0) + 1;

  ghCommitFiles_([
    { rel: 'state/members/' + file.publicMemberId + '.json', json: file },
    { rel: 'state/board.json', json: githubBoardWithMember_(file) }
  ], 'Save progress for ' + file.publicMemberId);

  var dungeons2 = sealProgress_(githubDungeonRows_(file));
  var stimBoundary = lastStimReset_(new Date(), stimAnchor_());
  var next = stimBoundary ? new Date(stimBoundary.getTime() + STIM_RESET_PERIOD_MS).toISOString() : null;
  return {
    changed: true, dungeons: dungeons2, totals: sealTotals_(dungeons2),
    stimVault: githubStimPublic_(file, next), difficulty: githubDifficultyPublic_(file)
  };
}

// -------------------------------------------------------------------------
// Migration actions (admin-only)
// -------------------------------------------------------------------------

function migPutMeta_(key, value) {
  ensureMemberMapSheet_();
  var t = readTable_(GH_MIGRATION_SHEET), sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GH_MIGRATION_SHEET);
  var row = t.rows.filter(function (r) { return String(r.Key) === key; })[0];
  var val = typeof value === 'string' ? value : JSON.stringify(value);
  if (row) sheet.getRange(row._row, 2, 1, 2).setValues([[val, new Date()]]);
  else sheet.appendRow([key, val, new Date()]);
}
function migGetMeta_(key) {
  ensureMemberMapSheet_();
  var r = readTable_(GH_MIGRATION_SHEET).rows.filter(function (x) { return String(x.Key) === key; })[0];
  if (!r) return null;
  try { return JSON.parse(String(r.Value)); } catch (_) { return String(r.Value); }
}

/** Hash of the STABLE source content (per member) so EXECUTE can confirm the
 * spreadsheet hasn't changed since PREVIEW. Volatile/derived fields
 * (updatedAt, board, manifest, generatedAt) are excluded so the same source
 * fingerprints identically across calls. */
function datasetFingerprint_(dataset) {
  var stable = dataset.files.map(function (f) {
    return {
      publicMemberId: f.publicMemberId, characterName: f.characterName,
      profile: f.profile, classes: f.classes, stimVault: f.stimVault,
      masterSeal: f.masterSeal, nmRaidCompleted: f.nmRaidCompleted, easyHardRaidCompleted: f.easyHardRaidCompleted,
      raidResetPeriod: f.raidResetPeriod, stimVaultResetPeriod: f.stimVaultResetPeriod
    };
  });
  return hash_(JSON.stringify(stable));
}

/** Validate the assembled dataset; returns { warnings, memberCount }. */
function validateDataset_(dataset) {
  var warnings = [], seenPublic = {}, seenName = {};
  dataset.files.forEach(function (f) {
    try { ghAssertNoPrivate_(f, f.publicMemberId); } catch (e) { warnings.push('Private field in ' + f.publicMemberId + ': ' + e.message); }
    if (seenPublic[f.publicMemberId]) warnings.push('Duplicate publicMemberId ' + f.publicMemberId);
    seenPublic[f.publicMemberId] = true;
    var nm = String(f.characterName || '').toLowerCase();
    if (nm && seenName[nm]) warnings.push('Duplicate character name "' + f.characterName + '"');
    seenName[nm] = true;
    (f.classes || []).forEach(function (x) {
      try { classValidate_(String(x.classId), String(x.buildId)); } catch (e) { warnings.push('Bad class/build for ' + f.publicMemberId + ': ' + e.message); }
    });
    if (typeof f.nmRaidCompleted !== 'boolean' || typeof f.easyHardRaidCompleted !== 'boolean') {
      warnings.push('Non-boolean raid flags for ' + f.publicMemberId);
    }
  });
  return { warnings: warnings, memberCount: dataset.files.length };
}

/** PREVIEW: build from Sheets, validate, change nothing, mint a confirm token. */
function previewGithubMigration_(token) {
  return withAdminLock_(token, function (actor) {
    if (!githubConfigured_()) throw apiError_('CONFIG', 'GitHub data storage is not configured.');
    var dataset = buildDataset_();
    var report = validateDataset_(dataset);
    var fingerprint = datasetFingerprint_(dataset);
    var confirm = 'mig-' + hash_(fingerprint + ':' + Date.now()).slice(0, 24);
    migPutMeta_('previewConfirm', { token: confirm, fingerprint: fingerprint, at: iso_(new Date()), by: String(actor.MemberId) });
    var summary = {
      memberCount: report.memberCount,
      warnings: report.warnings,
      added: report.memberCount, changed: 0, skipped: 0, rejected: report.warnings.length,
      confirmToken: confirm,
      raidConversionNote: 'Legacy Raid maps to Easy/Hard only; NM defaults to false.'
    };
    migPutMeta_('lastPreview', { at: iso_(new Date()), memberCount: report.memberCount, warnings: report.warnings.length });
    audit_(String(actor.MemberId), 'GH_MIGRATION_PREVIEW', '', report.memberCount + ' members, ' + report.warnings.length + ' warnings');
    return summary;
  });
}

/** EXECUTE: require the preview token, re-check the source, one atomic commit. */
function executeGithubMigration_(token, d) {
  return withAdminLock_(token, function (actor) {
    if (!githubConfigured_()) throw apiError_('CONFIG', 'GitHub data storage is not configured.');
    var stored = migGetMeta_('previewConfirm');
    if (!stored || !d || stored.token !== d.confirmToken) throw apiError_('CONFIRM_REQUIRED', 'Run and confirm a migration preview first.');
    var dataset = buildDataset_();
    if (datasetFingerprint_(dataset) !== stored.fingerprint) {
      throw apiError_('SOURCE_CHANGED', 'The spreadsheet changed since the preview. Re-run the preview.');
    }
    var report = validateDataset_(dataset);
    if (report.warnings.length) throw apiError_('VALIDATION', 'Cannot migrate: ' + report.warnings.length + ' validation warning(s). Resolve them and re-preview.');
    var commit = ghCommitFiles_(datasetCommitFiles_(dataset), 'Initial OnlyPaws state migration (' + report.memberCount + ' members)');
    migPutMeta_('lastExecute', { at: iso_(new Date()), commit: commit.commit, memberCount: report.memberCount });
    migPutMeta_('previewConfirm', {});   // single-use
    audit_(String(actor.MemberId), 'GH_MIGRATION_EXECUTE', commit.commit, report.memberCount + ' members committed');
    return { commit: commit.commit, memberCount: report.memberCount };
  });
}

/** VERIFY: read GitHub back and compare against a freshly-built Sheets dataset. */
function verifyGithubMigration_(token) {
  return withAdminLock_(token, function (actor) {
    if (!githubConfigured_()) throw apiError_('CONFIG', 'GitHub data storage is not configured.');
    var expected = buildDataset_();
    var boardRead = ghReadJson_('state/board.json');
    if (!boardRead.exists) throw apiError_('GITHUB', 'No board.json in GitHub — run the migration first.');
    var problems = [];
    // Member counts.
    var expectedBoard = expected.board.rows;
    var actualBoard = boardRead.json.rows || [];
    if (expectedBoard.length !== actualBoard.length) problems.push('Member count differs: sheets ' + expectedBoard.length + ' vs github ' + actualBoard.length);
    // Compare approved fields + recomputed scores/ranks + raid conversion + private scan.
    var byPublic = {}; actualBoard.forEach(function (r) { byPublic[r.publicMemberId] = r; });
    expected.files.forEach(function (f) {
      var read = ghReadJson_('state/members/' + f.publicMemberId + '.json');
      if (!read.exists) { problems.push('Missing member file ' + f.publicMemberId); return; }
      var g = read.json;
      try { ghAssertNoPrivate_(g, f.publicMemberId); } catch (e) { problems.push('Private field leaked into ' + f.publicMemberId + ': ' + e.message); }
      if (String(g.characterName) !== String(f.characterName)) problems.push('Name mismatch for ' + f.publicMemberId);
      if (Boolean(g.nmRaidCompleted) !== Boolean(f.nmRaidCompleted)) problems.push('NM raid mismatch for ' + f.publicMemberId);
      if (Boolean(g.easyHardRaidCompleted) !== Boolean(f.easyHardRaidCompleted)) problems.push('Easy/Hard raid mismatch for ' + f.publicMemberId);
      var er = boardRowFromMember_(f), gr = byPublic[f.publicMemberId];
      if (gr && er.totalScore !== gr.totalScore) problems.push('Score mismatch for ' + f.publicMemberId);
    });
    var pass = problems.length === 0;
    migPutMeta_('lastVerify', { at: iso_(new Date()), pass: pass, problems: problems.length });
    audit_(String(actor.MemberId), 'GH_MIGRATION_VERIFY', '', pass ? 'passed' : (problems.length + ' problem(s)'));
    return { pass: pass, problems: problems, memberCount: actualBoard.length };
  });
}

/** Admin status for the GitHub Data Storage panel. Never returns the token. */
function getGithubStorageStatus_(token) {
  admin_(token);
  var status = ghSafeStatus_();
  var head = null;
  try { head = githubConfigured_() ? ghBranchHead_() : null; } catch (_) { head = null; }
  return {
    mode: status.mode, configured: status.configured, hasToken: status.hasToken,
    owner: status.owner, repo: status.repo, branch: status.branch, prefix: status.prefix,
    currentCommit: head, schemaVersion: GH_SCHEMA_VERSION,
    lastPreview: migGetMeta_('lastPreview'),
    lastExecute: migGetMeta_('lastExecute'),
    lastVerify: migGetMeta_('lastVerify')
  };
}

/** Switch storage mode (admin). github mode requires a passed verification. */
function switchGithubStorageMode_(token, d) {
  return withAdminLock_(token, function (actor) {
    var mode = d && d.mode;
    if (['sheets', 'shadow', 'github'].indexOf(mode) === -1) throw apiError_('VALIDATION', 'Mode must be sheets, shadow or github.');
    if (mode === 'github') {
      if (!githubConfigured_()) throw apiError_('CONFIG', 'GitHub data storage is not configured.');
      var v = migGetMeta_('lastVerify');
      if (!v || !v.pass) throw apiError_('VERIFY_REQUIRED', 'Verification must pass before enabling github mode.');
    }
    PropertiesService.getScriptProperties().setProperty('GITHUB_DATA_MODE', mode);
    audit_(String(actor.MemberId), 'GH_MODE_SWITCH', '', 'mode=' + mode);
    return { mode: mode };
  });
}
