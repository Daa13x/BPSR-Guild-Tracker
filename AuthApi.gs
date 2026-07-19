/**
 * Private account API — passwordless remembered-device accounts.
 * Public data is always projected by Code.gs.
 *
 * Accounts are created with only a character name. Access is retained through
 * an opaque remembered-device session token (stored hashed) and restored on a
 * new browser with the member's backup code. Backup codes are stored readable
 * in the private Members sheet so administrators can recover members — an
 * explicit product decision for a trusted guild; the sheet must stay private.
 * Legacy PinSalt/PinHash columns are deprecated and no longer used.
 */
var AUTH_SHEETS = { MEMBERS: 'Members', SESSIONS: 'Sessions', ATTEMPTS: 'LoginAttempts' };
var MEMBER_HEADERS = ['MemberId', 'CharacterName', 'NormalizedName', 'PinSalt', 'PinHash', 'CreatedAt', 'DisabledAt',
  'BackupCode', 'BackupCodeCreatedAt', 'BackupCodeUpdatedAt', 'LastAccessAt'];
var SESSION_HEADERS = ['TokenHash', 'MemberId', 'Kind', 'ExpiresAt', 'RevokedAt', 'CreatedAt', 'LastUsedAt'];
var ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000, MAX_BODY = 20000;
var TOUCH_INTERVAL_MS = 60 * 60 * 1000;
var RESTORE_MESSAGE = 'Character name or backup code is incorrect.';
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function ensureAuthSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, AUTH_SHEETS.MEMBERS, MEMBER_HEADERS);
  ensureSheet_(ss, AUTH_SHEETS.SESSIONS, SESSION_HEADERS);
  ensureSheet_(ss, AUTH_SHEETS.ATTEMPTS, ['Key', 'Count', 'WindowStarted', 'BlockedUntil']);
  ensureColumns_(ss.getSheetByName(AUTH_SHEETS.MEMBERS), MEMBER_HEADERS);
  ensureColumns_(ss.getSheetByName(AUTH_SHEETS.SESSIONS), SESSION_HEADERS);
}

/** Append any missing header columns; never reorders or deletes existing data. */
function ensureColumns_(sheet, headers) {
  var width = sheet.getLastColumn();
  var current = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
  headers.forEach(function (h) {
    if (current.indexOf(h) === -1) {
      current.push(h);
      sheet.getRange(1, current.length).setValue(h);
    }
  });
}

function colIndex_(table, header) { return table.headers.indexOf(header) + 1; }

function hash_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function equal_(a, b) { a = String(a); b = String(b); var d = a.length ^ b.length; for (var i = 0; i < Math.max(a.length, b.length); i++)d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
function cleanName_(v) { var s = String(v || '').replace(/[<>]/g, '').trim().replace(/\s+/g, ' '); if (!/^[A-Za-z0-9][A-Za-z0-9 '\-]{1,39}$/.test(s)) throw apiError_('VALIDATION', 'Invalid character name.'); return s; }
function norm_(v) { return cleanName_(v).toLowerCase(); }
function apiError_(code, message) { var e = new Error(message); e.code = code; return e; }
function table_(n) { return readTable_(n); }
function member_(id) { return table_(AUTH_SHEETS.MEMBERS).rows.filter(function (r) { return String(r.MemberId) === String(id); })[0] || null; }
function memberName_(name) { var n = norm_(name); return table_(AUTH_SHEETS.MEMBERS).rows.filter(function (r) { return String(r.NormalizedName) === n && !r.DisabledAt; })[0] || null; }
function token_() { return Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); }

// ---------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------

/** BPSR-XXXX-XXXX-XXXX from UUID entropy (~59 bits); no ambiguous characters. */
function newBackupCode_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Utilities.getUuid());
  var out = '';
  for (var i = 0; i < 12; i++) {
    var n = ((bytes[i] & 255) << 8) + (bytes[i + 12] & 255);
    out += CODE_ALPHABET.charAt(n % CODE_ALPHABET.length);
  }
  return 'BPSR-' + out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
}

/** Case-insensitive, separator-insensitive comparison form. */
function normalizeCode_(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function validCodeInput_(v) { if (typeof v !== 'string') return false; var n = normalizeCode_(v); return n.length >= 8 && n.length <= 32; }

function writeMemberCell_(memberRow, header, value) {
  var t = table_(AUTH_SHEETS.MEMBERS), col = colIndex_(t, header);
  if (col > 0) t.sheet.getRange(memberRow._row, col).setValue(value);
}

/** Return the member's readable code, generating and storing one if missing. */
function ensureBackupCode_(m) {
  if (m.BackupCode) return String(m.BackupCode);
  var code = newBackupCode_(), now = new Date();
  writeMemberCell_(m, 'BackupCode', code);
  writeMemberCell_(m, 'BackupCodeCreatedAt', now);
  writeMemberCell_(m, 'BackupCodeUpdatedAt', now);
  return code;
}

function touchMemberAccess_(id, force) {
  var m = member_(id);
  if (!m) return;
  var last = m.LastAccessAt ? new Date(m.LastAccessAt).getTime() : 0;
  if (force || !last || Date.now() - last > TOUCH_INTERVAL_MS) writeMemberCell_(m, 'LastAccessAt', new Date());
}

// ---------------------------------------------------------------------------
// Sessions — long-lived remembered-device tokens; only the hash is stored
// ---------------------------------------------------------------------------

function memberSessionMs_() { return clampInt_(cfg_('MEMBER_SESSION_DAYS'), 1, 3650, 180) * 24 * 60 * 60 * 1000; }

function session_(token, kind) {
  if (typeof token !== 'string' || token.length < 40) throw apiError_('SESSION_EXPIRED', 'Session expired.');
  var t = table_(AUTH_SHEETS.SESSIONS);
  var r = t.rows.filter(function (x) { return equal_(x.TokenHash, hash_(token)) && String(x.Kind) === kind && !x.RevokedAt && new Date(x.ExpiresAt) > new Date(); })[0];
  if (!r) throw apiError_('SESSION_EXPIRED', 'Session expired.');
  var col = colIndex_(t, 'LastUsedAt');
  var used = r.LastUsedAt ? new Date(r.LastUsedAt).getTime() : 0;
  if (col > 0 && (!used || Date.now() - used > TOUCH_INTERVAL_MS)) t.sheet.getRange(r._row, col).setValue(new Date());
  return r;
}

function sessionMaybe_(token, kind) { try { return session_(token, kind); } catch (e) { return null; } }

function newSession_(id, kind) {
  var t = token_();
  var ttl = kind === 'member' ? memberSessionMs_() : ADMIN_SESSION_TTL_MS;
  var exp = new Date(Date.now() + ttl), now = new Date();
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEETS.SESSIONS)
    .appendRow([hash_(t), id, kind, exp, '', now, now]);
  return { token: t, expiresAt: exp.toISOString() };
}

function revokeToken_(token, kind) { var t = table_(AUTH_SHEETS.SESSIONS), h = hash_(token); t.rows.forEach(function (r) { if (equal_(r.TokenHash, h) && String(r.Kind) === String(kind) && !r.RevokedAt) t.sheet.getRange(r._row, 5).setValue(new Date()); }); }
function revokeMember_(id, kind) { var t = table_(AUTH_SHEETS.SESSIONS); t.rows.forEach(function (r) { if (String(r.MemberId) === String(id) && (!kind || String(r.Kind) === kind) && !r.RevokedAt) t.sheet.getRange(r._row, 5).setValue(new Date()); }); }

function throttle_(key, success, message) {
  var msg = message || 'Invalid credentials.';
  var t = table_(AUTH_SHEETS.ATTEMPTS), r = t.rows.filter(function (x) { return String(x.Key) === key; })[0], now = Date.now();
  if (r && r.BlockedUntil && new Date(r.BlockedUntil) > new Date()) throw apiError_('INVALID_CREDENTIALS', msg);
  if (success) { if (r) t.sheet.getRange(r._row, 2, 1, 3).setValues([[0, new Date(), '']]); return; }
  var count = (r && now - new Date(r.WindowStarted).getTime() < 900000 ? Number(r.Count) : 0) + 1, block = count >= 5 ? new Date(now + 900000) : '';
  if (r) t.sheet.getRange(r._row, 2, 1, 3).setValues([[count, new Date(), block]]);
  else t.sheet.appendRow([key, count, new Date(), block]);
  throw apiError_('INVALID_CREDENTIALS', msg);
}

// ---------------------------------------------------------------------------
// Account creation, restore and migration — no PIN, no password
// ---------------------------------------------------------------------------

function createAccount_(d) {
  ensureAuthSheets_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var name = cleanName_(d.characterName), n = norm_(name);
    if (memberName_(name)) throw apiError_('DUPLICATE', 'That character name already has an account. Use Returning user with its backup code.');
    var id = uid_('MEM'), code = newBackupCode_(), now = new Date();
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEETS.MEMBERS)
      .appendRow([id, name, n, '', '', now, '', code, now, now, now]);
    writePlayerRow_({ UserId: id, CharacterName: name, SVFloor: 0, SVFloorDate: '', EasyComplete: false, EasyDate: '', HardComplete: false, HardDate: '', MasterPoints: 0, MasterPointsDate: '', MountEarned: false, MountEarnedAt: '', MountPosition: '', MountPointsWhenEarned: '', LastUpdated: now, RegisteredAt: now, IsAdmin: false, Notes: '' });
    return { member: profile_(id), session: newSession_(id, 'member'), backupCode: code };
  } finally {
    lock.releaseLock();
  }
}

/** Returning user: character name + backup code. Failures are generic and throttled. */
function restore_(d) {
  ensureAuthSheets_();
  var key = hash_('restore:' + String(d.characterName || '').toLowerCase()), m = null;
  try { m = memberName_(d.characterName || ''); } catch (e) { throttle_(key, false, RESTORE_MESSAGE); }
  if (!m || !m.BackupCode || !validCodeInput_(d.backupCode) ||
    !equal_(normalizeCode_(m.BackupCode), normalizeCode_(d.backupCode))) {
    throttle_(key, false, RESTORE_MESSAGE);
  }
  throttle_(key, true, RESTORE_MESSAGE);
  touchMemberAccess_(m.MemberId, true);
  return { member: profile_(m.MemberId), session: newSession_(m.MemberId, 'member') };
}

/**
 * Exchange a still-valid legacy session for a remembered-device session.
 * Guarantees the member has a backup code and returns it for the one-time
 * "Please save this somewhere" panel.
 */
function migrate_(d) {
  ensureAuthSheets_();
  var s = session_(d.token, 'member'), m = member_(s.MemberId);
  if (!m || m.DisabledAt) throw apiError_('SESSION_EXPIRED', 'Session expired.');
  var code = ensureBackupCode_(m);
  revokeToken_(d.token, 'member');
  touchMemberAccess_(m.MemberId, true);
  return { member: profile_(m.MemberId), session: newSession_(m.MemberId, 'member'), backupCode: code };
}

function myBackupCode_(token) {
  var s = session_(token, 'member'), m = member_(s.MemberId);
  if (!m || m.DisabledAt) throw apiError_('SESSION_EXPIRED', 'Session expired.');
  return { backupCode: String(m.BackupCode || ''), createdAt: iso_(m.BackupCodeCreatedAt), updatedAt: iso_(m.BackupCodeUpdatedAt) };
}

function revokeAllDevices_(token) {
  var s = session_(token, 'member');
  revokeMember_(s.MemberId, 'member');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profiles and progression (unchanged model)
// ---------------------------------------------------------------------------

function linkedPlayer_(id) { var members = table_(AUTH_SHEETS.MEMBERS).rows.filter(function (m) { return String(m.MemberId) === String(id); }), players = table_(SHEETS.PLAYERS).rows.filter(function (p) { return String(p.UserId) === String(id); }); if (members.length !== 1 || players.length !== 1) throw apiError_('IDENTITY_MISMATCH', 'Member identity is not linked to exactly one progression record.'); return players[0]; }
function profile_(id) { var p = linkedPlayer_(id); return { memberId: String(id), characterName: String(p.CharacterName || ''), svFloor: Number(p.SVFloor) || 0, masterPoints: Number(p.MasterPoints) || 0, masterRanks: myRanks_(id), isAdmin: truthy_(p.IsAdmin) }; }
function myRanks_(id) { var o = {}; table_(SHEETS.MASTER_PROGRESS).rows.forEach(function (r) { if (String(r.UserId) === String(id)) o[String(r.ActivityId)] = Number(r.Rank) || 0; }); return o; }
function integer_(v, min, max) { if (typeof v === 'string' && v.trim() === '') throw apiError_('VALIDATION', 'Invalid progression.'); var n = Number(v); if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw apiError_('VALIDATION', 'Invalid progression.'); return n; }
function progress_(id, d) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var p = findPlayer_(id); if (!p) throw apiError_('NOT_FOUND', 'Member not found.');
    var now = new Date(), period = ensureActivePeriod_(), changes = [];
    if (d.svFloor !== undefined) { var sv = integer_(d.svFloor, 1, 60); if (sv > Number(p.SVFloor || 0)) { p.SVFloor = sv; p.SVFloorDate = now; changes.push(['SV_FLOOR', '', sv]); } }
    var acts = {}; table_(SHEETS.ACTIVITIES).rows.forEach(function (a) { acts[String(a.ActivityId)] = a; });
    var ranks = d.masterRanks || {};
    Object.keys(ranks).forEach(function (aid) {
      var a = acts[aid]; if (!a || !truthy_(a.Active)) throw apiError_('VALIDATION', 'Invalid Master activity.');
      var rank = integer_(ranks[aid], 0, Number(a.MaxRank) || 20), old = myRanks_(id)[aid] || 0;
      if (rank > old) {
        var t = table_(SHEETS.MASTER_PROGRESS), existing = t.rows.filter(function (r) { return String(r.UserId) === String(id) && String(r.ActivityId) === aid; })[0];
        if (existing) t.sheet.getRange(existing._row, 3, 1, 2).setValues([[rank, now]]);
        else t.sheet.appendRow([id, aid, rank, now]);
        changes.push(['MASTER_RANK', aid, rank]);
      }
    });
    if (!changes.length) return { changed: false, profile: profile_(id) };
    p.LastUpdated = now; writePlayerRow_(p);
    changes.forEach(function (c) { appendEvent_(evt_(id, p.CharacterName, c[0], c[1], '', c[2], period, true, true)); });
    if (!period.FirstUpdaterUserId && truthy_(cfg_('FIRST_UPDATER_ENABLED'))) { SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.RESETS).getRange(period._row, 6, 1, 3).setValues([[id, p.CharacterName, '']]); }
    bustCache_();
    return { changed: true, profile: profile_(id) };
  } finally { lock.releaseLock(); }
}
function activities_() { return table_(SHEETS.ACTIVITIES).rows.filter(function (a) { return truthy_(a.Active); }).map(function (a) { return { id: String(a.ActivityId), name: String(a.Name), maxRank: Number(a.MaxRank) || 20 }; }); }

// ---------------------------------------------------------------------------
// Administration — a valid member session plus a live Players.IsAdmin check.
// Cookie or browser flags are never trusted; the role is read per action.
// ---------------------------------------------------------------------------

function admin_(token) {
  var s = sessionMaybe_(token, 'member');
  if (s) {
    var m = member_(s.MemberId), p = findPlayer_(s.MemberId);
    if (!m || m.DisabledAt || !p || !truthy_(p.IsAdmin)) throw apiError_('FORBIDDEN', 'Administrator access required.');
    return s;
  }
  s = session_(token, 'admin'); // recovery bootstrap or legacy admin sessions
  if (String(s.MemberId) === 'bootstrap') return s;
  var lm = member_(s.MemberId), lp = findPlayer_(s.MemberId);
  if (!lm || lm.DisabledAt || !lp || !truthy_(lp.IsAdmin)) throw apiError_('FORBIDDEN', 'Administrator access required.');
  return s;
}

function adminLogin_(d) { var key = 'admin-recovery', secret = PropertiesService.getScriptProperties().getProperty('BPSR_ADMIN_SECRET'); if (!secret || typeof d.secret !== 'string' || !equal_(hash_(secret), hash_(d.secret))) throttle_(key, false, 'Invalid credentials.'); throttle_(key, true); return { session: newSession_('bootstrap', 'admin'), recovery: true }; }
function withAdminLock_(token, work) { var lock = LockService.getScriptLock(); lock.waitLock(20000); try { return work(admin_(token)); } finally { lock.releaseLock(); } }

/** Active remembered-device session count per member. */
function sessionStats_() {
  var now = new Date(), counts = {};
  table_(AUTH_SHEETS.SESSIONS).rows.forEach(function (r) {
    if (String(r.Kind) === 'member' && !r.RevokedAt && new Date(r.ExpiresAt) > now) counts[String(r.MemberId)] = (counts[String(r.MemberId)] || 0) + 1;
  });
  return counts;
}

function memberMeta_(m, counts) {
  return {
    disabled: !!m.DisabledAt,
    backupCodeSet: !!m.BackupCode,
    backupCodeCreatedAt: iso_(m.BackupCodeCreatedAt),
    backupCodeUpdatedAt: iso_(m.BackupCodeUpdatedAt),
    lastAccessAt: iso_(m.LastAccessAt),
    activeSessions: (counts || sessionStats_())[String(m.MemberId)] || 0
  };
}

function adminMembers_(q) {
  var s = String(q || '').toLowerCase(), counts = sessionStats_();
  return table_(AUTH_SHEETS.MEMBERS).rows.filter(function (m) { return String(m.CharacterName).toLowerCase().indexOf(s) >= 0; }).map(function (m) {
    var p = profile_(m.MemberId), meta = memberMeta_(m, counts);
    meta.memberId = String(m.MemberId); meta.characterName = p.characterName; meta.svFloor = p.svFloor;
    meta.masterPoints = p.masterPoints; meta.isAdmin = p.isAdmin;
    return meta;
  });
}

function adminRead_(id) {
  var m = member_(id);
  if (!m) throw apiError_('NOT_FOUND', 'Member not found.');
  var p = profile_(id), meta = memberMeta_(m);
  Object.keys(meta).forEach(function (k) { p[k] = meta[k]; });
  p.memberId = String(id);
  return p;
}

/** Reveal is admin-only, audited, and never appears in public payloads. */
function adminBackupCode_(token, id) {
  return withAdminLock_(token, function (actor) {
    var m = member_(id);
    if (!m) throw apiError_('NOT_FOUND', 'Member not found.');
    audit_(String(actor.MemberId), 'VIEW_BACKUP_CODE', String(id), 'Backup code revealed to administrator');
    return { memberId: String(id), characterName: String(m.CharacterName), backupCode: String(m.BackupCode || ''), backupCodeSet: !!m.BackupCode, createdAt: iso_(m.BackupCodeCreatedAt), updatedAt: iso_(m.BackupCodeUpdatedAt) };
  });
}

function adminRegenerateBackupCode_(token, d) {
  return withAdminLock_(token, function (actor) {
    var m = member_(d.memberId);
    if (!m) throw apiError_('NOT_FOUND', 'Member not found.');
    var code = newBackupCode_(), now = new Date();
    writeMemberCell_(m, 'BackupCode', code);
    if (!m.BackupCodeCreatedAt) writeMemberCell_(m, 'BackupCodeCreatedAt', now);
    writeMemberCell_(m, 'BackupCodeUpdatedAt', now);
    var revoked = d.revokeSessions === true;
    if (revoked) revokeMember_(d.memberId, 'member');
    audit_(String(actor.MemberId), 'REGENERATE_BACKUP_CODE', String(d.memberId),
      revoked ? 'Backup code regenerated and devices revoked' : 'Backup code regenerated');
    return { backupCode: code, profile: adminRead_(d.memberId) };
  });
}

function adminRevokeSessions_(token, d) {
  return withAdminLock_(token, function (actor) {
    var m = member_(d.memberId);
    if (!m) throw apiError_('NOT_FOUND', 'Member not found.');
    revokeMember_(d.memberId, 'member');
    audit_(String(actor.MemberId), 'REVOKE_SESSIONS', String(d.memberId), 'All remembered devices revoked');
    return adminRead_(d.memberId);
  });
}

function setDisabledUnlocked_(actor, id, disabled) { var m = member_(id), p = linkedPlayer_(id); if (disabled && truthy_(p.IsAdmin)) { var admins = activeAdminIds_(); if (admins.length <= 1 && admins.indexOf(String(id)) !== -1) throw apiError_('LAST_ADMIN', 'The last active administrator cannot be disabled.'); } writeMemberCell_(m, 'DisabledAt', disabled ? new Date() : ''); if (disabled) revokeMember_(id); audit_(String(actor.MemberId), disabled ? 'DISABLE_MEMBER' : 'ENABLE_MEMBER', String(id), disabled ? 'Disabled and sessions revoked' : 'Member enabled'); bustCache_(); return adminRead_(id); }
function adminSetDisabled_(token, id, disabled) { if (typeof disabled !== 'boolean') throw apiError_('VALIDATION', 'Disabled state must be true or false.'); return withAdminLock_(token, function (actor) { return setDisabledUnlocked_(actor, id, disabled); }); }
function activeAdminIds_() { var members = {}, admins = {}; table_(AUTH_SHEETS.MEMBERS).rows.forEach(function (m) { if (!m.DisabledAt) members[String(m.MemberId)] = true; }); table_(SHEETS.PLAYERS).rows.forEach(function (p) { var id = String(p.UserId); if (members[id] && truthy_(p.IsAdmin)) admins[id] = true; }); return Object.keys(admins); }
function adminSetRole_(token, d) { if (typeof d.isAdmin !== 'boolean') throw apiError_('VALIDATION', 'Administrator state must be true or false.'); return withAdminLock_(token, function (actor) { var target = linkedPlayer_(d.memberId), desired = d.isAdmin, current = truthy_(target.IsAdmin); if (current === desired) return adminRead_(d.memberId); if (!desired) { var admins = activeAdminIds_(); if (admins.length <= 1 && admins.indexOf(String(d.memberId)) !== -1) throw apiError_('LAST_ADMIN', 'The last active administrator cannot be demoted.'); if (String(actor.MemberId) === String(d.memberId) && d.confirmSelf !== true) throw apiError_('CONFIRM_SELF', 'Self-demotion requires explicit confirmation.'); } target.IsAdmin = desired; writePlayerRow_(target); if (!desired) revokeMember_(d.memberId, 'admin'); audit_(String(actor.MemberId), 'SET_ADMIN_ROLE', String(d.memberId), desired ? 'Promoted to administrator' : 'Demoted from administrator'); bustCache_(); return adminRead_(d.memberId); }); }
function adminEdit_(token, id, d) { return withAdminLock_(token, function (actor) { var p = linkedPlayer_(id); if (d.characterName !== undefined) { var n = cleanName_(d.characterName), other = memberName_(n); if (other && String(other.MemberId) !== String(id)) throw apiError_('DUPLICATE', 'Character name is unavailable.'); var m = member_(id), t = table_(AUTH_SHEETS.MEMBERS); t.sheet.getRange(m._row, 2, 1, 2).setValues([[n, norm_(n)]]); p.CharacterName = n; } if (d.svFloor !== undefined) p.SVFloor = integer_(d.svFloor, 1, 60); writePlayerRow_(p); audit_(String(actor.MemberId), 'EDIT_MEMBER', String(id), 'Administrative correction'); bustCache_(); return adminRead_(id); }); }
function adminDuplicates_() { var by = {}, out = []; table_(AUTH_SHEETS.MEMBERS).rows.forEach(function (m) { if (m.DisabledAt) return; var n = String(m.NormalizedName); (by[n] = by[n] || []).push(String(m.MemberId)); }); Object.keys(by).forEach(function (n) { if (by[n].length > 1) { var members = by[n].map(function (id) { return adminRead_(id); }); out.push({ normalizedName: n, memberIds: by[n], members: members }); } }); return out; }
function adminMerge_(token, keep, remove) { return withAdminLock_(token, function (actor) { if (String(keep) === String(remove)) throw apiError_('VALIDATION', 'Choose two different members.'); var keepMember = member_(keep), removeMember = member_(remove), keepPlayer = linkedPlayer_(keep), removePlayer = linkedPlayer_(remove), admins = activeAdminIds_(); if (!keepMember || !removeMember) throw apiError_('NOT_FOUND', 'Member not found.'); if (truthy_(removePlayer.IsAdmin) && admins.length <= 1 && (!truthy_(keepPlayer.IsAdmin) || keepMember.DisabledAt)) throw apiError_('LAST_ADMIN', 'Merge would remove the last active administrator.'); var mp = table_(SHEETS.MASTER_PROGRESS), ev = table_(SHEETS.EVENTS), ah = table_(SHEETS.ACHIEVEMENTS), seal = table_(MASTER_SEAL_SHEET); [mp, ev, ah].forEach(function (t) { t.rows.forEach(function (r) { if (String(r.UserId || r.PlayerUserId) === String(remove)) { var col = t.headers.indexOf(r.UserId !== undefined ? 'UserId' : 'PlayerUserId') + 1; t.sheet.getRange(r._row, col).setValue(keep); } }); }); seal.rows.forEach(function (r) { if (String(r.MemberId) === String(remove)) seal.sheet.getRange(r._row, 1).setValue(keep); }); setDisabledUnlocked_(actor, remove, true); audit_(String(actor.MemberId), 'MERGE_MEMBER', String(remove), 'Merged into ' + keep); return adminRead_(keep); }); }
function adminReset_(token) { return withAdminLock_(token, function (actor) { var t = table_(SHEETS.RESETS); t.rows.forEach(function (r) { if (String(r.Status) === 'Active') closePeriod_(r, String(actor.MemberId)); }); openPeriod_(String(actor.MemberId)); audit_(String(actor.MemberId), 'MANUAL_RESET', '', 'New update period'); bustCache_(); return { ok: true }; }); }
function adminCorrect_(token, d) { return withAdminLock_(token, function (actor) { var t = table_(SHEETS.ACHIEVEMENTS), r = t.rows.filter(function (x) { return String(x.AchievementId) === String(d.achievementId); })[0]; if (!r) throw apiError_('NOT_FOUND', 'Achievement not found.'); if (d.characterName) t.sheet.getRange(r._row, 4).setValue(cleanName_(d.characterName)); t.sheet.getRange(r._row, 10, 1, 2).setValues([[true, String(d.notes || '').slice(0, 300)]]); audit_(String(actor.MemberId), 'CORRECT_ACHIEVEMENT', String(d.achievementId), 'API correction'); bustCache_(); return { ok: true }; }); }

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function api_(a, d) {
  if (a === 'createAccount') return createAccount_(d);
  if (a === 'restore') return restore_(d);
  if (a === 'migrate') return migrate_(d);
  if (a === 'myBackupCode') return myBackupCode_(d.token);
  if (a === 'revokeAllDevices') return revokeAllDevices_(d.token);
  if (a === 'adminLogin') return adminLogin_(d);
  if (a === 'leaderboard') return JSON.parse(getLeaderboardBundle());
  if (a === 'activities') return activities_();
  if (a === 'masterSeal') return masterSealBoard_();
  if (a === 'myMasterSeal') return myMasterSeal_(d.token);
  if (a === 'masterSealUpdate') return masterSealUpdate_(d.token, d);
  if (a === 'adminMasterSealEdit') return adminMasterSealEdit_(d.token, d);
  if (a === 'me') { var s = session_(d.token, 'member'); touchMemberAccess_(s.MemberId); return profile_(s.MemberId); }
  if (a === 'refresh') {
    var kind = d.kind === 'admin' ? 'admin' : 'member';
    var x = kind === 'admin' ? admin_(d.token) : session_(d.token, 'member');
    var out = { expiresAt: iso_(x.ExpiresAt) };
    if (kind === 'member') { touchMemberAccess_(x.MemberId); out.profile = profile_(x.MemberId); }
    return out;
  }
  if (a === 'progress') { var me = session_(d.token, 'member'); return progress_(me.MemberId, d); }
  if (a === 'logout') { if (d.token) { var logoutKind = d.kind === 'admin' ? 'admin' : 'member'; session_(d.token, logoutKind); revokeToken_(d.token, logoutKind); } return { ok: true }; }
  if (a === 'adminMembers') { admin_(d.token); return adminMembers_(d.query); }
  if (a === 'adminRead') { admin_(d.token); return adminRead_(d.memberId); }
  if (a === 'adminBackupCode') return adminBackupCode_(d.token, d.memberId);
  if (a === 'adminRegenerateBackupCode') return adminRegenerateBackupCode_(d.token, d);
  if (a === 'adminRevokeSessions') return adminRevokeSessions_(d.token, d);
  if (a === 'adminEdit') return adminEdit_(d.token, d.memberId, d);
  if (a === 'adminDisable' || a === 'adminDelete') return adminSetDisabled_(d.token, d.memberId, true);
  if (a === 'adminSetDisabled') return adminSetDisabled_(d.token, d.memberId, d.disabled);
  if (a === 'adminSetRole') return adminSetRole_(d.token, d);
  if (a === 'adminDuplicates') { admin_(d.token); return adminDuplicates_(); }
  if (a === 'adminMerge') return adminMerge_(d.token, d.keepMemberId, d.removeMemberId);
  if (a === 'adminReset') return adminReset_(d.token);
  if (a === 'adminCorrectAchievement') return adminCorrect_(d.token, d);
  if (a === 'adminAudit') { admin_(d.token); return table_(SHEETS.AUDIT).rows.slice(-100).map(function (r) { return { at: iso_(r.Timestamp), action: String(r.Action), target: String(r.Target), details: String(r.Details) }; }); }
  throw apiError_('UNKNOWN_ACTION', 'Unknown action.');
}

function doPost(e) { try { var raw = (e && e.postData && e.postData.contents) || ''; if (raw.length > MAX_BODY) throw apiError_('TOO_LARGE', 'Invalid request.'); var p = JSON.parse(raw); if (!p || typeof p.action !== 'string' || typeof p.data !== 'object') throw apiError_('MALFORMED', 'Invalid request.'); return ContentService.createTextOutput(JSON.stringify({ ok: true, data: api_(p.action, p.data || {}) })).setMimeType(ContentService.MimeType.JSON); } catch (err) { return ContentService.createTextOutput(JSON.stringify({ ok: false, error: { code: err.code || 'REQUEST_FAILED', message: err.code ? err.message : 'Request could not be completed.' } })).setMimeType(ContentService.MimeType.JSON); } }
