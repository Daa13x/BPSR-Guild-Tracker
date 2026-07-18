/**
 * Guild Leaderboard & Achievements — Google Apps Script backend
 * ------------------------------------------------------------
 * Standalone implementation built from the leaderboard spec.
 *
 * Deploy as a Web App:
 *   Deploy > New deployment > Web app
 *   Execute as: User accessing the web app
 *   Who has access: anyone in your guild's domain / anyone with link
 *
 * Run setupSpreadsheet() once from the editor to create all sheets.
 *
 * SECURITY MODEL
 *  - All totals are recalculated and validated server-side. The browser
 *    only ever *requests* changes; the server compares against stored
 *    records before writing anything (spec: never trust browser totals).
 *  - Emails / user IDs are never included in any public payload.
 *  - AchievementHistory, ProgressEvents and ResetPeriods are written by
 *    this script only. Protect them in the spreadsheet UI too:
 *    Data > Protect sheets, allow only the script owner.
 */

// ---------------------------------------------------------------------------
// Constants & sheet names
// ---------------------------------------------------------------------------

var SHEETS = {
  CONFIG: 'Config',
  PLAYERS: 'Players',
  ACTIVITIES: 'MasterActivities',
  MASTER_PROGRESS: 'MasterProgress',
  ACHIEVEMENTS: 'AchievementHistory',
  EVENTS: 'ProgressEvents',
  RESETS: 'ResetPeriods',
  AUDIT: 'AuditLog'
};

var SV_MAX_FLOOR = 60;

var DEFAULT_CONFIG = {
  MOUNT_TARGET: 3650,               // configurable mount target
  OUTDATED_DAYS: 14,                // "outdated" indicator threshold
  RESET_FREQUENCY: 'weekly',        // weekly | monthly | seasonal | manual
  RESET_DAY: 'Monday',              // weekly reset day
  RESET_TIME: '06:00',              // HH:mm in RESET_TIMEZONE
  RESET_TIMEZONE: 'Europe/London',
  REGISTRATION_COUNTS: 'false',     // does creating an account count as an update?
  ADMINS_ELIGIBLE: 'true',          // can admins win First Guildie to Update?
  FIRST_UPDATER_PUBLIC: 'true',     // show the winner publicly
  FIRST_UPDATER_ENABLED: 'true',    // feature toggle
  ACTIVITY_FEED_ENABLED: 'true',    // recent guild progress feed toggle
  OVERALL_SCORE_ENABLED: 'false',   // combined score is OFF unless explicitly enabled
  OVERALL_SCORE_FORMULA: '',        // e.g. "sv*10+points" (only used if enabled)
  ADMIN_EMAILS: '',                 // comma-separated admin emails
  CUSTOM_MILESTONES: '[]',          // JSON: [{"id":"MP1000","label":"1,000 Master points","type":"points","value":1000}]
  CACHE_SECONDS: '90'               // public leaderboard cache TTL
};

var ACH = {
  FIRST_SV60: 'FIRST_SV_FLOOR_60',
  FIRST_MOUNT: 'FIRST_MOUNT',
  FIRST_MMAX: 'FIRST_MMAX_',        // + activityId
  FIRST_ALL_MASTERS: 'FIRST_ALL_MASTERS',
  FIRST_MILESTONE: 'FIRST_MILESTONE_', // + milestone id
  MOUNT_EARNED: 'MOUNT_EARNED'      // one per player, hall-of-fame source
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.CONFIG, ['Key', 'Value']);
  ensureSheet_(ss, SHEETS.PLAYERS, [
    'UserId', 'CharacterName', 'SVFloor', 'SVFloorDate',
    'EasyComplete', 'EasyDate', 'HardComplete', 'HardDate',
    'MasterPoints', 'MasterPointsDate',
    'MountEarned', 'MountEarnedAt', 'MountPosition', 'MountPointsWhenEarned',
    'LastUpdated', 'RegisteredAt', 'IsAdmin', 'Notes'
  ]);
  ensureSheet_(ss, SHEETS.ACTIVITIES, ['ActivityId', 'Name', 'MaxRank', 'Active']);
  ensureSheet_(ss, SHEETS.MASTER_PROGRESS, ['UserId', 'ActivityId', 'Rank', 'CompletedDate']);
  ensureSheet_(ss, SHEETS.ACHIEVEMENTS, [
    'AchievementId', 'AchievementType', 'PlayerUserId', 'CharacterNameSnapshot',
    'ActivityId', 'ValueAchieved', 'AchievementTimestamp', 'ResetPeriodId',
    'RecordedBy', 'CorrectedStatus', 'CorrectionNotes'
  ]);
  ensureSheet_(ss, SHEETS.EVENTS, [
    'EventId', 'Timestamp', 'UserId', 'CharacterNameSnapshot', 'EventType',
    'ActivityId', 'PreviousValue', 'NewValue', 'ResetPeriodId',
    'PublicVisibility', 'ValidLeaderboardEvent'
  ]);
  ensureSheet_(ss, SHEETS.RESETS, [
    'ResetPeriodId', 'StartTimestamp', 'EndTimestamp', 'ResetType', 'Status',
    'FirstUpdaterUserId', 'FirstUpdaterCharacterNameSnapshot', 'WinningEventId', 'CreatedBy'
  ]);
  ensureSheet_(ss, SHEETS.AUDIT, ['Timestamp', 'Actor', 'Action', 'Target', 'Details']);
  // Character/PIN data is kept separately from public leaderboard rows.
  ensureAuthSheets_();

  // Seed config defaults without overwriting existing values.
  var cfgSheet = ss.getSheetByName(SHEETS.CONFIG);
  var existing = readConfig_();
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    if (!(k in existing)) cfgSheet.appendRow([k, DEFAULT_CONFIG[k]]);
  });

  // Do not seed demo members. Activities are illustrative configuration only.
  var actSheet = ss.getSheetByName(SHEETS.ACTIVITIES);
  if (actSheet.getLastRow() < 2) {
    for (var i = 1; i <= 5; i++) {
      actSheet.appendRow(['ACT' + i, 'Master Activity ' + i, 20, true]);
    }
  }
  ensureActivePeriod_();
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------------------
// Web app entry
// ---------------------------------------------------------------------------

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: 'BPSR Guild Tracker API',
    status: 'ready',
    message: 'Use POST requests for API actions.'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function readConfig_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  var cfg = {};
  if (!sh || sh.getLastRow() < 2) return cfg;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) cfg[String(r[0])] = String(r[1]);
  });
  return cfg;
}

function cfg_(key) {
  var c = readConfig_();
  return (key in c) ? c[key] : DEFAULT_CONFIG[key];
}

function isAdmin_(email) {
  if (!email) return false;
  var admins = cfg_('ADMIN_EMAILS').split(',').map(function (s) { return s.trim().toLowerCase(); });
  if (admins.indexOf(email.toLowerCase()) !== -1) return true;
  var p = findPlayer_(email);
  return !!(p && truthy_(p.IsAdmin));
}

function truthy_(v) {
  return v === true || String(v).toLowerCase() === 'true' || String(v) === '1';
}

// ---------------------------------------------------------------------------
// Data access (batched reads — no per-row scanning)
// ---------------------------------------------------------------------------

function readTable_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { headers: [], rows: [], sheet: sh };
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var headers = values[0].map(String);
  var rows = values.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
  return { headers: headers, rows: rows, sheet: sh };
}

function findPlayer_(userId) {
  var t = readTable_(SHEETS.PLAYERS);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].UserId).toLowerCase() === String(userId).toLowerCase()) return t.rows[i];
  }
  return null;
}

function writePlayerRow_(player) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PLAYERS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var row = headers.map(function (h) { return (h in player) ? player[h] : ''; });
  if (player._row) sh.getRange(player._row, 1, 1, headers.length).setValues([row]);
  else sh.appendRow(row);
}

function uid_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 12);
}

// ---------------------------------------------------------------------------
// Reset periods
// ---------------------------------------------------------------------------

function ensureActivePeriod_() {
  var t = readTable_(SHEETS.RESETS);
  var active = null;
  t.rows.forEach(function (r) { if (String(r.Status) === 'Active') active = r; });

  var freq = cfg_('RESET_FREQUENCY');
  var now = new Date();

  if (active && freq !== 'manual') {
    var end = active.EndTimestamp ? new Date(active.EndTimestamp) : null;
    if (end && now >= end) {
      closePeriod_(active, 'system');
      active = null;
    }
  }
  if (!active) active = openPeriod_('system');
  return active;
}

function openPeriod_(createdBy) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.RESETS);
  var id = uid_('RP');
  var now = new Date();
  var freq = cfg_('RESET_FREQUENCY');
  var end = (freq === 'manual') ? '' : nextResetBoundary_(now);
  sh.appendRow([id, now, end, freq, 'Active', '', '', '', createdBy]);
  return { ResetPeriodId: id, StartTimestamp: now, EndTimestamp: end, ResetType: freq, Status: 'Active', FirstUpdaterUserId: '', _row: sh.getLastRow() };
}

function closePeriod_(period, actor) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.RESETS);
  sh.getRange(period._row, 5).setValue('Closed');            // Status
  if (!period.EndTimestamp) sh.getRange(period._row, 3).setValue(new Date()); // EndTimestamp
  audit_(actor, 'CLOSE_PERIOD', period.ResetPeriodId, 'Period closed');
}

/** Next reset boundary strictly after `from`, in the configured timezone. */
function nextResetBoundary_(from) {
  var tz = cfg_('RESET_TIMEZONE') || 'Europe/London';
  var freq = cfg_('RESET_FREQUENCY');
  var hhmm = (cfg_('RESET_TIME') || '06:00').split(':');
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var targetDow = Math.max(0, days.indexOf(cfg_('RESET_DAY') || 'Monday'));

  // Walk forward day by day (max 370 iterations) and return the first
  // date whose local (tz) representation matches the reset rule.
  var probe = new Date(from.getTime());
  for (var i = 0; i < 370; i++) {
    var local = Utilities.formatDate(probe, tz, 'yyyy-MM-dd EEEE MM dd');
    var parts = local.split(' ');
    var dowName = parts[1], month = parseInt(parts[2], 10), dom = parseInt(parts[3], 10);
    var match = false;
    if (freq === 'weekly') match = (dowName === days[targetDow]);
    else if (freq === 'monthly') match = (dom === 1);
    else if (freq === 'seasonal') match = (dom === 1 && [1, 4, 7, 10].indexOf(month) !== -1);
    if (match) {
      var candidate = tzDate_(parts[0], hhmm[0], hhmm[1], tz);
      if (candidate > from) return candidate;
    }
    probe = new Date(probe.getTime() + 24 * 3600 * 1000);
  }
  return new Date(from.getTime() + 7 * 24 * 3600 * 1000); // safety fallback
}

/** Build a Date for yyyy-MM-dd HH:mm interpreted in `tz`. */
function tzDate_(ymd, hh, mm, tz) {
  // Find the UTC instant whose tz-local representation equals the target.
  var guess = new Date(ymd + 'T' + pad2_(hh) + ':' + pad2_(mm) + ':00Z');
  for (var i = 0; i < 3; i++) {
    var localized = Utilities.formatDate(guess, tz, "yyyy-MM-dd'T'HH:mm:ss");
    var want = ymd + 'T' + pad2_(hh) + ':' + pad2_(mm) + ':00';
    var diff = new Date(want + 'Z').getTime() - new Date(localized + 'Z').getTime();
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function pad2_(n) { return ('0' + String(parseInt(n, 10))).slice(-2); }

/** Admin: begin a new update period manually. Historical winners are kept. */
function startNewPeriod() {
  var email = Session.getActiveUser().getEmail();
  if (!isAdmin_(email)) throw new Error('Only administrators can start a new period.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = readTable_(SHEETS.RESETS);
    t.rows.forEach(function (r) { if (String(r.Status) === 'Active') closePeriod_(r, email); });
    openPeriod_(email);
    bustCache_();
    audit_(email, 'MANUAL_RESET', '', 'New update period started manually');
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Progress submission — the only write path for player data
// ---------------------------------------------------------------------------

/**
 * payload = {
 *   characterName, svFloor, easyComplete, hardComplete, masterPoints,
 *   masterRanks: { ACT1: 14, ... }, notes
 * }
 * The server diffs against the stored record; only genuine changes create
 * events, achievements or First-Guildie awards. Re-saving identical data
 * writes nothing (duplicate-event prevention).
 */
function submitProgress(payload) {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('Sign-in required to update progress.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = new Date();
    var period = ensureActivePeriod_();
    var stored = findPlayer_(email);
    var isNew = !stored;

    var name = sanitizeName_(payload.characterName || (stored && stored.CharacterName) || 'Unknown');
    var svFloor = clampInt_(payload.svFloor, 0, SV_MAX_FLOOR, stored ? Number(stored.SVFloor) || 0 : 0);
    var points = clampInt_(payload.masterPoints, 0, 100000, stored ? Number(stored.MasterPoints) || 0 : 0);
    var easy = !!payload.easyComplete;
    var hard = !!payload.hardComplete;
    var ranks = payload.masterRanks || {};

    var player = stored || {
      UserId: email, CharacterName: name, SVFloor: 0, SVFloorDate: '',
      EasyComplete: false, EasyDate: '', HardComplete: false, HardDate: '',
      MasterPoints: 0, MasterPointsDate: '',
      MountEarned: false, MountEarnedAt: '', MountPosition: '', MountPointsWhenEarned: '',
      LastUpdated: now, RegisteredAt: now, IsAdmin: false, Notes: ''
    };

    var events = [];   // genuine progression changes only
    var prevSv = Number(player.SVFloor) || 0;
    var prevPoints = Number(player.MasterPoints) || 0;

    // -- SV floor: only increases count (server-validated) --
    if (svFloor > prevSv) {
      events.push(evt_(email, name, 'SV_FLOOR', '', prevSv, svFloor, period, true, true));
      player.SVFloor = svFloor;
      player.SVFloorDate = now;              // date the current highest floor was achieved
    }

    // -- Easy / Hard newly completed (one-way flags) --
    if (easy && !truthy_(player.EasyComplete)) {
      events.push(evt_(email, name, 'EASY_COMPLETE', '', false, true, period, true, true));
      player.EasyComplete = true; player.EasyDate = now;
    }
    if (hard && !truthy_(player.HardComplete)) {
      events.push(evt_(email, name, 'HARD_COMPLETE', '', false, true, period, true, true));
      player.HardComplete = true; player.HardDate = now;
    }

    // -- Master points: any actual change counts; date only refreshes on change --
    if (points !== prevPoints) {
      events.push(evt_(email, name, 'MASTER_POINTS', '', prevPoints, points, period, true, true));
      player.MasterPoints = points;
      player.MasterPointsDate = now;
    }

    // -- Master ranks per activity: only increases count --
    var actTable = readTable_(SHEETS.ACTIVITIES);
    var activities = {};
    actTable.rows.forEach(function (a) { activities[String(a.ActivityId)] = a; });
    var mpTable = readTable_(SHEETS.MASTER_PROGRESS);
    var myRanks = {};
    mpTable.rows.forEach(function (r) {
      if (String(r.UserId).toLowerCase() === email.toLowerCase()) myRanks[String(r.ActivityId)] = r;
    });
    var mpSheet = mpTable.sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MASTER_PROGRESS);

    Object.keys(ranks).forEach(function (actId) {
      var a = activities[actId];
      if (!a || !truthy_(a.Active)) return;                       // ignore unknown/inactive
      var maxRank = Number(a.MaxRank) || 20;
      var newRank = clampInt_(ranks[actId], 0, maxRank, 0);
      var cur = myRanks[actId] ? Number(myRanks[actId].Rank) || 0 : 0;
      if (newRank > cur) {
        events.push(evt_(email, name, 'MASTER_RANK', actId, cur, newRank, period, true, true));
        if (myRanks[actId]) {
          mpSheet.getRange(myRanks[actId]._row, 3, 1, 2).setValues([[newRank, now]]);
          myRanks[actId].Rank = newRank;
        } else {
          mpSheet.appendRow([email, actId, newRank, now]);
          myRanks[actId] = { UserId: email, ActivityId: actId, Rank: newRank, CompletedDate: now };
        }
      }
    });

    // -- Mount: awarded once; timestamp/position/points never change afterwards --
    var mountTarget = Number(cfg_('MOUNT_TARGET')) || 3650;
    if (!truthy_(player.MountEarned) && Number(player.MasterPoints) >= mountTarget) {
      player.MountEarned = true;
      player.MountEarnedAt = now;
      player.MountPointsWhenEarned = Number(player.MasterPoints);
      player.MountPosition = countAchievements_(ACH.MOUNT_EARNED) + 1;
      events.push(evt_(email, name, 'MOUNT_EARNED', '', false, true, period, true, true));
      recordAchievement_(ACH.MOUNT_EARNED, email, name, '', player.MasterPoints, now, period.ResetPeriodId);
      maybeFirst_(ACH.FIRST_MOUNT, email, name, '', player.MasterPoints, now, period);
    }

    // -- Name / notes changes are saved but are NOT progression events --
    player.CharacterName = name;
    if (payload.notes !== undefined) player.Notes = sanitizeName_(String(payload.notes)).slice(0, 300);

    // -- Registration event (never a leaderboard event; badge eligibility is configurable) --
    if (isNew) {
      appendEvent_(evt_(email, name, 'REGISTERED', '', '', '', period, false,
        truthy_(cfg_('REGISTRATION_COUNTS'))));
    }

    var genuine = events.length > 0;
    if (genuine || isNew) player.LastUpdated = now;
    writePlayerRow_(player);
    events.forEach(appendEvent_);

    // -- First-to-achieve records (server-side, at the moment they occur) --
    if (Number(player.SVFloor) >= SV_MAX_FLOOR && prevSv < SV_MAX_FLOOR) {
      maybeFirst_(ACH.FIRST_SV60, email, name, '', SV_MAX_FLOOR, now, period);
    }
    Object.keys(activities).forEach(function (actId) {
      var a = activities[actId];
      if (!truthy_(a.Active)) return;
      var maxRank = Number(a.MaxRank) || 20;
      var r = myRanks[actId];
      if (r && Number(r.Rank) >= maxRank) {
        maybeFirst_(ACH.FIRST_MMAX + actId, email, name, actId, maxRank, now, period);
      }
    });
    var allDone = actTable.rows.filter(function (a) { return truthy_(a.Active); })
      .every(function (a) {
        var r = myRanks[String(a.ActivityId)];
        return r && Number(r.Rank) >= (Number(a.MaxRank) || 20);
      });
    if (allDone && actTable.rows.some(function (a) { return truthy_(a.Active); })) {
      maybeFirst_(ACH.FIRST_ALL_MASTERS, email, name, '', '', now, period);
    }
    customMilestones_().forEach(function (m) {
      var hit = (m.type === 'points' && Number(player.MasterPoints) >= Number(m.value)) ||
                (m.type === 'sv' && Number(player.SVFloor) >= Number(m.value));
      if (hit) maybeFirst_(ACH.FIRST_MILESTONE + m.id, email, name, '', m.value, now, period);
    });

    // -- First Guildie to Update: first *genuine* change in the period --
    var badge = false;
    if (genuine && truthy_(cfg_('FIRST_UPDATER_ENABLED')) && !period.FirstUpdaterUserId) {
      var eligible = truthy_(cfg_('ADMINS_ELIGIBLE')) || !isAdmin_(email);
      if (isNew && !truthy_(cfg_('REGISTRATION_COUNTS'))) {
        // A brand-new registration only wins if the config allows it —
        // but genuine progress submitted *with* registration still counts
        // as progress; the toggle governs pure registrations, which never
        // reach here because they produce no events.
      }
      if (eligible) {
        var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.RESETS);
        sh.getRange(period._row, 6, 1, 3).setValues([[email, name, events[0].id]]);
        badge = true;
      }
    }

    if (genuine) bustCache_();
    return { ok: true, changed: genuine, firstGuildie: badge,
             changes: events.map(function (e) { return e.type; }) };
  } finally {
    lock.releaseLock();
  }
}

function evt_(userId, name, type, actId, prev, next, period, isPublic, valid) {
  return { id: uid_('EV'), ts: new Date(), userId: userId, name: name, type: type,
           actId: actId, prev: prev, next: next, periodId: period.ResetPeriodId,
           isPublic: isPublic, valid: valid };
}

function appendEvent_(e) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EVENTS)
    .appendRow([e.id, e.ts, e.userId, e.name, e.type, e.actId,
                String(e.prev), String(e.next), e.periodId, e.isPublic, e.valid]);
}

function sanitizeName_(s) {
  return String(s).replace(/[<>]/g, '').trim().slice(0, 40);
}

function clampInt_(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function customMilestones_() {
  try { return JSON.parse(cfg_('CUSTOM_MILESTONES')) || []; }
  catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

function countAchievements_(type) {
  var t = readTable_(SHEETS.ACHIEVEMENTS);
  return t.rows.filter(function (r) { return String(r.AchievementType) === type; }).length;
}

function recordAchievement_(type, userId, name, actId, value, ts, periodId) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ACHIEVEMENTS)
    .appendRow([uid_('ACH'), type, userId, name, actId, String(value), ts, periodId,
                'system', false, '']);
}

/** Record a first-to-achieve exactly once. Later edits never replace it. */
function maybeFirst_(type, userId, name, actId, value, ts, period) {
  if (countAchievements_(type) > 0) return;
  recordAchievement_(type, userId, name, actId, value, ts, period.ResetPeriodId);
}

/** Admin-only correction of an achievement record, written to the audit log. */
function correctAchievement(achievementId, newName, notes) {
  var email = Session.getActiveUser().getEmail();
  if (!isAdmin_(email)) throw new Error('Only administrators can correct achievement records.');
  var t = readTable_(SHEETS.ACHIEVEMENTS);
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (String(r.AchievementId) === String(achievementId)) {
      var sh = t.sheet;
      if (newName) sh.getRange(r._row, 4).setValue(sanitizeName_(newName));
      sh.getRange(r._row, 10, 1, 2).setValues([[true, String(notes || '')]]);
      audit_(email, 'CORRECT_ACHIEVEMENT', achievementId, 'Name→' + (newName || '(unchanged)') + ' | ' + (notes || ''));
      bustCache_();
      return { ok: true };
    }
  }
  throw new Error('Achievement not found.');
}

function audit_(actor, action, target, details) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUDIT)
    .appendRow([new Date(), actor, action, target, details]);
}

// ---------------------------------------------------------------------------
// Leaderboard bundle — one server call, batched reads, short public cache
// ---------------------------------------------------------------------------

function bustCache_() {
  CacheService.getScriptCache().remove('leaderboards_v1');
}

function getLeaderboardBundle() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('leaderboards_v1');
  var bundle;
  if (cached) {
    bundle = JSON.parse(cached);
  } else {
    bundle = buildBundle_();
    var ttl = clampInt_(cfg_('CACHE_SECONDS'), 10, 600, 90);
    try { cache.put('leaderboards_v1', JSON.stringify(bundle), ttl); } catch (e) { /* too large: skip cache */ }
  }
  // Per-viewer extras are never cached.
  var email = Session.getActiveUser().getEmail() || '';
  bundle.viewer = { isAdmin: isAdmin_(email), signedIn: !!email };
  var me = email ? findPlayer_(email) : null;
  bundle.viewerCharacter = me ? String(me.CharacterName) : '';
  return JSON.stringify(bundle);
}

function buildBundle_() {
  ensureActivePeriod_();
  var now = new Date();
  var mountTarget = Number(cfg_('MOUNT_TARGET')) || 3650;
  var outdatedDays = Number(cfg_('OUTDATED_DAYS')) || 14;

  var players = readTable_(SHEETS.PLAYERS).rows;
  var activities = readTable_(SHEETS.ACTIVITIES).rows.filter(function (a) { return truthy_(a.Active); });
  var progress = readTable_(SHEETS.MASTER_PROGRESS).rows;
  var achievements = readTable_(SHEETS.ACHIEVEMENTS).rows;
  var events = readTable_(SHEETS.EVENTS).rows;
  var periods = readTable_(SHEETS.RESETS).rows;

  var byUser = {};
  progress.forEach(function (r) {
    var u = String(r.UserId).toLowerCase();
    (byUser[u] = byUser[u] || {})[String(r.ActivityId)] = r;
  });

  // Public player projection — no emails, no user IDs.
  var pub = players.map(function (p) {
    var u = String(p.UserId).toLowerCase();
    var mine = byUser[u] || {};
    var atMax = 0, totalRanks = 0, bestRankDate = null;
    activities.forEach(function (a) {
      var r = mine[String(a.ActivityId)];
      if (!r) return;
      var rank = Number(r.Rank) || 0;
      totalRanks += rank;
      if (rank >= (Number(a.MaxRank) || 20)) {
        atMax++;
        var d = r.CompletedDate ? new Date(r.CompletedDate) : null;
        if (d && (!bestRankDate || d > bestRankDate)) bestRankDate = d;
      }
    });
    var last = p.LastUpdated ? new Date(p.LastUpdated) : null;
    var sv = Number(p.SVFloor) || 0;
    var pts = Number(p.MasterPoints) || 0;
    return {
      name: String(p.CharacterName),
      sv: sv,
      svPct: Math.round(sv / SV_MAX_FLOOR * 100),
      svDate: iso_(p.SVFloorDate),
      svComplete: sv >= SV_MAX_FLOOR,
      easy: truthy_(p.EasyComplete),
      hard: truthy_(p.HardComplete),
      points: pts,
      pointsPct: Math.min(100, Math.round(pts / mountTarget * 100)),
      pointsRemaining: Math.max(0, mountTarget - pts),
      pointsDate: iso_(p.MasterPointsDate),
      mount: truthy_(p.MountEarned),
      mountAt: iso_(p.MountEarnedAt),
      mountPosition: p.MountPosition === '' ? null : Number(p.MountPosition),
      mountPoints: p.MountPointsWhenEarned === '' ? null : Number(p.MountPointsWhenEarned),
      mastersAtMax: atMax,
      totalRanks: totalRanks,
      mastersDate: bestRankDate ? bestRankDate.toISOString() : null,
      lastUpdated: iso_(p.LastUpdated),
      outdated: last ? ((now - last) / 86400000 > outdatedDays) : true
    };
  });

  // SV leaderboard: floor desc, earliest date, name.
  var svBoard = pub.slice().sort(function (a, b) {
    return (b.sv - a.sv) || dateAsc_(a.svDate, b.svDate) || nameAsc_(a, b);
  });

  // Master points: effective total desc, earliest date, name.
  var mpBoard = pub.slice().sort(function (a, b) {
    return (b.points - a.points) || dateAsc_(a.pointsDate, b.pointsDate) || nameAsc_(a, b);
  });

  // Master completion: at-max count, total ranks, points, earliest date.
  var mcBoard = pub.slice().sort(function (a, b) {
    return (b.mastersAtMax - a.mastersAtMax) || (b.totalRanks - a.totalRanks) ||
           (b.points - a.points) || dateAsc_(a.mastersDate, b.mastersDate) || nameAsc_(a, b);
  });

  // Mount hall of fame, in the order first earned. Timestamps are immutable.
  var hall = achievements
    .filter(function (r) { return String(r.AchievementType) === ACH.MOUNT_EARNED; })
    .sort(function (a, b) { return new Date(a.AchievementTimestamp) - new Date(b.AchievementTimestamp); })
    .map(function (r, i) {
      return { position: i + 1, name: String(r.CharacterNameSnapshot),
               points: Number(r.ValueAchieved) || null, at: iso_(r.AchievementTimestamp),
               corrected: truthy_(r.CorrectedStatus) };
    });

  // First-to-achieve records.
  var firsts = achievements
    .filter(function (r) { return String(r.AchievementType).indexOf('FIRST_') === 0; })
    .sort(function (a, b) { return new Date(a.AchievementTimestamp) - new Date(b.AchievementTimestamp); })
    .map(function (r) {
      return { type: String(r.AchievementType), name: String(r.CharacterNameSnapshot),
               activityId: String(r.ActivityId || ''), value: String(r.ValueAchieved || ''),
               at: iso_(r.AchievementTimestamp), corrected: truthy_(r.CorrectedStatus) };
    });

  // First Guildie to Update — current period + previous winners.
  var showWinner = truthy_(cfg_('FIRST_UPDATER_PUBLIC'));
  var fgEnabled = truthy_(cfg_('FIRST_UPDATER_ENABLED'));
  var current = null, previous = [];
  var eventById = {};
  events.forEach(function (e) { eventById[String(e.EventId)] = e; });
  periods.slice().sort(function (a, b) { return new Date(b.StartTimestamp) - new Date(a.StartTimestamp); })
    .forEach(function (r) {
      var win = null;
      if (r.FirstUpdaterUserId && showWinner) {
        var we = eventById[String(r.WinningEventId)];
        win = { name: String(r.FirstUpdaterCharacterNameSnapshot),
                at: we ? iso_(we.Timestamp) : iso_(r.StartTimestamp),
                what: we ? describeEvent_(we) : 'Progress update' };
      }
      var entry = { periodId: String(r.ResetPeriodId), start: iso_(r.StartTimestamp),
                    end: iso_(r.EndTimestamp), type: String(r.ResetType),
                    status: String(r.Status), winner: win };
      if (String(r.Status) === 'Active' && !current) current = entry;
      else previous.push(entry);
    });

  // Recent guild progress feed.
  var feedEnabled = truthy_(cfg_('ACTIVITY_FEED_ENABLED'));
  var actNames = {};
  activities.forEach(function (a) { actNames[String(a.ActivityId)] = String(a.Name); });
  var feed = !feedEnabled ? [] : events
    .filter(function (e) { return truthy_(e.PublicVisibility) && truthy_(e.ValidLeaderboardEvent); })
    .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
    .slice(0, 25)
    .map(function (e) { return { at: iso_(e.Timestamp), text: describeEvent_(e, actNames) }; });

  return {
    generatedAt: now.toISOString(),
    config: {
      mountTarget: mountTarget, svMax: SV_MAX_FLOOR, outdatedDays: outdatedDays,
      overallEnabled: truthy_(cfg_('OVERALL_SCORE_ENABLED')),
      feedEnabled: feedEnabled, firstGuildieEnabled: fgEnabled,
      timezone: cfg_('RESET_TIMEZONE')
    },
    activities: activities.map(function (a) {
      return { id: String(a.ActivityId), name: String(a.Name), maxRank: Number(a.MaxRank) || 20 };
    }),
    svBoard: svBoard, mpBoard: mpBoard, mcBoard: mcBoard,
    hallOfFame: hall, firsts: firsts,
    firstGuildie: { enabled: fgEnabled, current: current, previous: previous.slice(0, 12) },
    feed: feed
  };
}

function describeEvent_(e, actNames) {
  var n = String(e.CharacterNameSnapshot || e.name);
  var type = String(e.EventType || e.type);
  var next = String(e.NewValue !== undefined ? e.NewValue : e.next);
  var actId = String(e.ActivityId !== undefined ? e.ActivityId : e.actId || '');
  var actName = (actNames && actNames[actId]) || actId;
  switch (type) {
    case 'SV_FLOOR': return n + ' reached SV Floor ' + next;
    case 'EASY_COMPLETE': return n + ' completed Easy';
    case 'HARD_COMPLETE': return n + ' completed Hard';
    case 'MASTER_POINTS': return n + ' is on ' + Number(next).toLocaleString() + ' Master points';
    case 'MASTER_RANK': return n + ' completed M' + next + ' in ' + actName;
    case 'MOUNT_EARNED': return n + ' earned the mount';
    default: return n + ' made progress';
  }
}

function dateAsc_(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;                // missing date ranks after a real one
  if (!b) return -1;
  return new Date(a) - new Date(b); // earlier achievement wins the tie
}

function nameAsc_(a, b) {
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 :
         a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
}

function iso_(v) {
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
