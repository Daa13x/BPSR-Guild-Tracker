/**
 * Master Seal — Season 3.
 * One authoritative season configuration; all scoring is derived from the six
 * per-dungeon records. The browser never supplies totals.
 */
var MASTER_SEAL_SHEET = 'MasterSeal';

var MASTER_SEAL_SEASON = {
  id: 'season-3',
  displayName: 'Season 3',
  maxScore: 3650,
  maxMasterLevel: 20,
  subtitle: 'Echoes of Ember',
  // The exact Season 3 end date has not been formally announced. Only the
  // published event and reward schedule is known, so no end date is asserted.
  endDateAnnounced: false,
  endsAt: null,
  scheduleThrough: '19 August 2026',
  dungeons: [
    { id: 'towering-ruin', number: 1, name: 'Void - Towering Ruin', shortName: 'Towering Ruin' },
    { id: 'tinas-mindrealm', number: 2, name: "Void - Tina's Mindrealm", shortName: "Tina's Mindrealm" },
    { id: 'cursed-radiant-tomb', number: 3, name: 'Cursed Radiant Tomb', shortName: 'Radiant Tomb' },
    { id: 'mech-facility', number: 4, name: 'Mech Facility', shortName: 'Mech Facility' },
    { id: 'mistveil-hunting-ground', number: 5, name: 'Mistveil Hunting Ground', shortName: 'Mistveil' },
    { id: 'sea-ringed-reef', number: 6, name: 'Sea-Ringed Reef', shortName: 'Sea-Ringed Reef' }
  ],
  rewards: [
    { score: 500, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
    { score: 1000, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
    { score: 1500, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
    { score: 2000, rewardName: '50 Rose Orbs', rewardType: 'currency', quantity: 50 },
    { score: 2500, rewardName: 'Avatar Frame', rewardType: 'frame' },
    { score: 3000, rewardName: 'Namecard', rewardType: 'namecard' },
    { score: 3650, rewardName: 'Mount: Neon Sonic', rewardType: 'mount' }
  ]
};

function ensureMasterSealSheet_() {
  ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), MASTER_SEAL_SHEET,
    ['MemberId', 'DungeonId', 'BestMasterLevel', 'Points', 'Cleared', 'UpdatedAt']);
}

function sealSeasonPublic_() {
  return JSON.parse(JSON.stringify(MASTER_SEAL_SEASON));
}

function sealDungeonIndex_() {
  var byId = {};
  MASTER_SEAL_SEASON.dungeons.forEach(function (d) { byId[d.id] = d; });
  return byId;
}

/** Rows grouped by member: { memberId: { dungeonId: row } } */
function sealRowsByMember_() {
  var grouped = {};
  readTable_(MASTER_SEAL_SHEET).rows.forEach(function (r) {
    var id = String(r.MemberId);
    (grouped[id] = grouped[id] || {})[String(r.DungeonId)] = r;
  });
  return grouped;
}

/** Six ordered dungeon records for one member; missing data contributes zero. */
function sealProgress_(memberRows) {
  return MASTER_SEAL_SEASON.dungeons.map(function (d) {
    var r = memberRows && memberRows[d.id];
    var level = r && r.BestMasterLevel !== '' && r.BestMasterLevel !== null && r.BestMasterLevel !== undefined
      ? Number(r.BestMasterLevel) : null;
    if (level !== null && !isFinite(level)) level = null;
    return {
      dungeonId: d.id,
      bestMasterLevel: level,
      points: r ? (Number(r.Points) || 0) : 0,
      cleared: r ? truthy_(r.Cleared) : false,
      updatedAt: r ? iso_(r.UpdatedAt) : null
    };
  });
}

/** Server-calculated totals. Remaining never below zero; progress never above 100. */
function sealTotals_(dungeons) {
  var total = dungeons.reduce(function (sum, d) { return sum + (Number(d.points) || 0); }, 0);
  var max = MASTER_SEAL_SEASON.maxScore;
  var latest = null;
  dungeons.forEach(function (d) {
    if (d.updatedAt && (!latest || d.updatedAt > latest)) latest = d.updatedAt;
  });
  return {
    totalScore: total,
    remainingScore: Math.max(max - total, 0),
    progressPercent: Math.min(Math.round(total / max * 1000) / 10, 100),
    clearedCount: dungeons.filter(function (d) { return d.cleared; }).length,
    mountUnlocked: total >= max,
    lastUpdated: latest
  };
}

/** Validate one submitted dungeon entry. Unknown IDs and invalid values reject. */
function sealValidateEntry_(dungeonId, entry) {
  var byId = sealDungeonIndex_();
  if (!byId[dungeonId]) throw apiError_('VALIDATION', 'Unknown dungeon.');
  if (!entry || typeof entry !== 'object') throw apiError_('VALIDATION', 'Invalid dungeon progress.');
  var level = null;
  if (entry.bestMasterLevel !== undefined && entry.bestMasterLevel !== null && entry.bestMasterLevel !== '') {
    level = integer_(entry.bestMasterLevel, 0, MASTER_SEAL_SEASON.maxMasterLevel);
  }
  var points = entry.points === undefined || entry.points === '' ? 0
    : integer_(entry.points, 0, MASTER_SEAL_SEASON.maxScore);
  var cleared = entry.cleared === true;
  if (entry.cleared !== undefined && typeof entry.cleared !== 'boolean') {
    throw apiError_('VALIDATION', 'Cleared must be true or false.');
  }
  if (!cleared && (points > 0 || level !== null)) {
    throw apiError_('VALIDATION', 'Uncleared dungeons cannot record points or a Master level.');
  }
  return { bestMasterLevel: level, points: points, cleared: cleared };
}

/** Upsert the submitted dungeons for one member. Identical data writes nothing. */
function sealWrite_(memberId, submitted) {
  ensureMasterSealSheet_();
  var validated = {};
  Object.keys(submitted || {}).forEach(function (dungeonId) {
    validated[dungeonId] = sealValidateEntry_(dungeonId, submitted[dungeonId]);
  });
  var table = readTable_(MASTER_SEAL_SHEET);
  var sheet = table.sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MASTER_SEAL_SHEET);
  var mine = {};
  table.rows.forEach(function (r) {
    if (String(r.MemberId) === String(memberId)) mine[String(r.DungeonId)] = r;
  });
  var now = new Date(), changed = false;
  Object.keys(validated).forEach(function (dungeonId) {
    var next = validated[dungeonId];
    var current = mine[dungeonId];
    var currentLevel = current && current.BestMasterLevel !== '' && current.BestMasterLevel !== null
      ? Number(current.BestMasterLevel) : null;
    var same = current &&
      currentLevel === next.bestMasterLevel &&
      (Number(current.Points) || 0) === next.points &&
      truthy_(current.Cleared) === next.cleared;
    if (same) return;
    changed = true;
    var levelCell = next.bestMasterLevel === null ? '' : next.bestMasterLevel;
    if (current) {
      sheet.getRange(current._row, 3, 1, 4).setValues([[levelCell, next.points, next.cleared, now]]);
    } else {
      sheet.appendRow([memberId, dungeonId, levelCell, next.points, next.cleared, now]);
    }
  });
  return changed;
}

// ---------------------------------------------------------------------------
// Stim Vault — the biweekly floor climb. It IS the SV (Shadow Vault) floor
// shown on the SV Leaderboard: the same value, edited in one place, and it
// resets every two weeks (Blue Protocol: Star Resonance, Monday 05:00 UTC-2).
// Backed by Players.SVFloor, so there is no separate store.
// ---------------------------------------------------------------------------
var STIM_VAULT_ID = 'stim-vault';

function stimAnchor_() { return cfg_('STIM_RESET_ANCHOR') || DEFAULT_CONFIG.STIM_RESET_ANCHOR; }
function stimResetEnabled_() { return truthy_(cfg_('STIM_RESET_ENABLED')); }

/**
 * Lazily clear the member's SV floor when a biweekly reset boundary has passed
 * since it was last set. Runs on load, so a member who returns after a reset
 * starts the new fortnight at floor 0; one who was on within the fortnight is
 * unchanged. The watermark is SVFloorDate, moved forward when we reset.
 */
function applyStimReset_(memberId, now) {
  if (!stimResetEnabled_()) return;
  var p = findPlayer_(memberId);
  if (!p) return;
  var floor = Number(p.SVFloor) || 0;
  if (floor > 0 && stimVaultStale_(p.SVFloorDate, now || new Date(), stimAnchor_())) {
    var when = now || new Date();
    p.SVFloor = 0;
    p.SVFloorDate = when;
    p.LastUpdated = when;
    writePlayerRow_(p);
    bustCache_();
  }
}

/** Public Stim Vault view: the current SV floor plus the fortnight window. */
function stimVaultPublic_(memberId, now) {
  applyStimReset_(memberId, now);
  var p = findPlayer_(memberId);
  var floor = p ? Number(p.SVFloor) || 0 : 0;
  var when = now || new Date();
  var boundary = lastStimReset_(when, stimAnchor_());
  return {
    id: STIM_VAULT_ID, name: 'Stim Vault',
    points: floor, bestMasterLevel: null, max: SV_MAX_FLOOR,
    enabled: stimResetEnabled_(),
    periodStart: boundary ? boundary.toISOString() : null,
    nextResetAt: boundary ? new Date(boundary.getTime() + STIM_RESET_PERIOD_MS).toISOString() : null
  };
}

/** Set the SV floor from the Stim Vault editor (0–60). Same value the SV
 * Leaderboard ranks; may be raised or lowered by the member directly. */
function stimWrite_(memberId, entry) {
  if (!entry || typeof entry !== 'object') return false;
  var floor = entry.points === undefined || entry.points === '' || entry.points === null
    ? 0 : integer_(entry.points, 0, SV_MAX_FLOOR);
  var p = linkedPlayer_(memberId);
  if ((Number(p.SVFloor) || 0) === floor) return false;
  var now = new Date();
  p.SVFloor = floor;
  p.SVFloorDate = now;
  p.LastUpdated = now;
  writePlayerRow_(p);
  bustCache_();
  return true;
}

/**
 * Clear completed NM Raid and Easy/Hard Raid when the weekly Monday reset has
 * passed since each was recorded. The two difficulties reset independently.
 * Also migrates a legacy `RaidComplete` value into the Easy/Hard column so the
 * old single-raid record is preserved during the transition.
 */
function applyRaidReset_(memberId, now) {
  var p = linkedPlayer_(memberId);
  var when = now || new Date();
  var raid = raidState_(p);
  var changed = false;

  // One-time migration of the legacy combined field into Easy/Hard.
  var ehSet = p.EHRaidComplete !== '' && p.EHRaidComplete !== null && p.EHRaidComplete !== undefined;
  if (!ehSet && (truthy_(p.RaidComplete) || p.RaidComplete === false)) {
    p.EHRaidComplete = truthy_(p.RaidComplete);
    p.EHRaidDate = p.RaidDate || '';
    p.RaidComplete = '';   // stop carrying the legacy combined field
    p.RaidDate = '';
    changed = true;
    raid = raidState_(p);
  }

  if (raid.nm && raidStale_(raid.nmDate, when, stimAnchor_())) {
    p.NMRaidComplete = false; p.NMRaidDate = ''; changed = true;
  }
  if (raid.easyHard && raidStale_(raid.easyHardDate, when, stimAnchor_())) {
    p.EHRaidComplete = false; p.EHRaidDate = ''; changed = true;
  }
  if (!changed) return false;
  p.LastUpdated = when;
  writePlayerRow_(p);
  bustCache_();
  return true;
}

/** Per-player difficulty state on the Players row. NM Raid and Easy/Hard Raid
 * are always separate booleans, never combined. */
function sealDifficultyPublic_(memberId) {
  applyRaidReset_(memberId);
  var p = linkedPlayer_(memberId);
  var raid = raidState_(p);
  return {
    easy: truthy_(p.EasyComplete),
    easyDate: iso_(p.EasyDate),
    hard: truthy_(p.HardComplete),
    hardDate: iso_(p.HardDate),
    nmRaidCompleted: raid.nm,
    nmRaidDate: iso_(raid.nmDate),
    easyHardRaidCompleted: raid.easyHard,
    easyHardRaidDate: iso_(raid.easyHardDate),
    master: truthy_(p.MasterComplete),
    masterDate: iso_(p.MasterDate)
  };
}

function sealDifficultyWrite_(memberId, entry) {
  if (!entry || typeof entry !== 'object' ||
      typeof entry.easy !== 'boolean' || typeof entry.hard !== 'boolean' ||
      typeof entry.nmRaidCompleted !== 'boolean' || typeof entry.easyHardRaidCompleted !== 'boolean' ||
      typeof entry.master !== 'boolean') {
    throw apiError_('VALIDATION', 'Easy, Hard, NM Raid, Easy/Hard Raid and Master completion values must be true or false.');
  }
  var p = linkedPlayer_(memberId);
  var raid = raidState_(p);
  var easyChanged = truthy_(p.EasyComplete) !== entry.easy;
  var hardChanged = truthy_(p.HardComplete) !== entry.hard;
  var nmChanged = raid.nm !== entry.nmRaidCompleted;
  var ehChanged = raid.easyHard !== entry.easyHardRaidCompleted;
  var masterChanged = truthy_(p.MasterComplete) !== entry.master;
  // Always write the separated raid columns so a legacy row is migrated even
  // when the value itself is unchanged (the legacy column is then cleared).
  var legacyPresent = p.RaidComplete !== '' && p.RaidComplete !== null && p.RaidComplete !== undefined;
  if (!easyChanged && !hardChanged && !nmChanged && !ehChanged && !masterChanged && !legacyPresent) return false;
  var now = new Date();
  if (easyChanged) { p.EasyComplete = entry.easy; p.EasyDate = entry.easy ? now : ''; }
  if (hardChanged) { p.HardComplete = entry.hard; p.HardDate = entry.hard ? now : ''; }
  p.NMRaidComplete = entry.nmRaidCompleted;
  p.NMRaidDate = entry.nmRaidCompleted ? (nmChanged ? now : (raid.nmDate || now)) : '';
  p.EHRaidComplete = entry.easyHardRaidCompleted;
  p.EHRaidDate = entry.easyHardRaidCompleted ? (ehChanged ? now : (raid.easyHardDate || now)) : '';
  p.RaidComplete = ''; p.RaidDate = '';   // never keep writing the legacy combined field
  if (masterChanged) { p.MasterComplete = entry.master; p.MasterDate = entry.master ? now : ''; }
  p.LastUpdated = now;
  writePlayerRow_(p);
  bustCache_();
  return true;
}

/** Own progress for the signed-in member, Stim Vault included and reset-checked. */
function myMasterSeal_(token) {
  var memberId = activeMemberId_(token);
  var stim = stimVaultPublic_(memberId);   // applies the biweekly reset on load
  var mine = sealRowsByMember_()[String(memberId)];
  var dungeons = sealProgress_(mine);
  return {
    season: sealSeasonPublic_(), dungeons: dungeons, totals: sealTotals_(dungeons), stimVault: stim,
    difficulty: sealDifficultyPublic_(memberId)
  };
}

function masterSealUpdate_(token, d) {
  var memberId = activeMemberId_(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var changed = sealWrite_(memberId, d.dungeons);
    var stimChanged = d.stimVault ? stimWrite_(memberId, d.stimVault) : false;
    var difficultyChanged = d.difficulty ? sealDifficultyWrite_(memberId, d.difficulty) : false;
    var mine = sealRowsByMember_()[String(memberId)];
    var dungeons = sealProgress_(mine);
    return {
      changed: changed || stimChanged || difficultyChanged,
      dungeons: dungeons,
      totals: sealTotals_(dungeons),
      stimVault: stimVaultPublic_(memberId),
      difficulty: sealDifficultyPublic_(memberId)
    };
  } finally {
    lock.releaseLock();
  }
}

function adminMasterSealEdit_(token, d) {
  return withAdminLock_(token, function (actor) {
    var target = member_(d.memberId);
    if (!target) throw apiError_('NOT_FOUND', 'Member not found.');
    var changed = sealWrite_(d.memberId, d.dungeons);
    if (changed) {
      audit_(String(actor.MemberId), 'EDIT_MASTER_SEAL', String(d.memberId), 'Administrative Master Seal correction');
    }
    var mine = sealRowsByMember_()[String(d.memberId)];
    var dungeons = sealProgress_(mine);
    return { changed: changed, dungeons: dungeons, totals: sealTotals_(dungeons) };
  });
}

/**
 * Public Master Seal board. No member IDs, no codes — names only, same
 * privacy stance as the existing leaderboard projection.
 */
function masterSealBoard_(viewerMemberId) {
  var grouped = sealRowsByMember_();
  var classEntries = classEntriesByMember_();
  var flags = {};
  var now = new Date(), raidResetChanged = false;
  readTable_(SHEETS.PLAYERS).rows.forEach(function (p) {
    // Join by the immutable member id. Character names may be renamed and are
    // presentation only, never a progression key.
    // This board already has every Players row in memory. Do not call
    // linkedPlayer_ here: that would re-read Players and Members once per
    // guild member and can make the Apps Script request time out.
    var raid = raidState_(p);
    var rowChanged = false;
    // Migrate legacy combined raid into Easy/Hard in place.
    var ehSet = p.EHRaidComplete !== '' && p.EHRaidComplete !== null && p.EHRaidComplete !== undefined;
    if (!ehSet && (truthy_(p.RaidComplete) || p.RaidComplete === false)) {
      p.EHRaidComplete = truthy_(p.RaidComplete); p.EHRaidDate = p.RaidDate || '';
      p.RaidComplete = ''; p.RaidDate = ''; rowChanged = true; raid = raidState_(p);
    }
    if (raid.nm && raidStale_(raid.nmDate, now, stimAnchor_())) { p.NMRaidComplete = false; p.NMRaidDate = ''; rowChanged = true; }
    if (raid.easyHard && raidStale_(raid.easyHardDate, now, stimAnchor_())) { p.EHRaidComplete = false; p.EHRaidDate = ''; rowChanged = true; }
    if (rowChanged) { p.LastUpdated = now; writePlayerRow_(p); raidResetChanged = true; raid = raidState_(p); }
    flags[String(p.UserId)] = {
      hidden: truthy_(p.Hidden), verified: truthy_(p.Verified),
      svFloor: masterSealSvFloor_(p.SVFloor),
      nmRaid: raid.nm, easyHardRaid: raid.easyHard
    };
  });
  if (raidResetChanged) bustCache_();
  var rows = [];
  readTable_(AUTH_SHEETS.MEMBERS).rows.forEach(function (m) {
    if (m.DisabledAt) return;
    // Hidden members stay off the board for everyone except themselves.
    var flag = flags[String(m.MemberId)] || { hidden: false, verified: false, svFloor: null, nmRaid: false, easyHardRaid: false };
    var isViewer = viewerMemberId && String(m.MemberId) === String(viewerMemberId);
    if (flag.hidden && !isViewer) return;
    var dungeons = sealProgress_(grouped[String(m.MemberId)]);
    var totals = sealTotals_(dungeons);
    rows.push({
      name: String(m.CharacterName),
      verified: flag.verified,
      hidden: flag.hidden,
      classes: classEntries[String(m.MemberId)] || [],
      svFloor: flag.svFloor,
      nmRaid: flag.nmRaid,
      easyHardRaid: flag.easyHardRaid,
      dungeons: dungeons.map(function (d) {
        return { dungeonId: d.dungeonId, bestMasterLevel: d.bestMasterLevel, points: d.points, cleared: d.cleared };
      }),
      totalScore: totals.totalScore,
      remainingScore: totals.remainingScore,
      progressPercent: totals.progressPercent,
      clearedCount: totals.clearedCount,
      mountUnlocked: totals.mountUnlocked,
      lastUpdated: totals.lastUpdated
    });
  });
  rows.sort(function (a, b) {
    return (b.totalScore - a.totalScore) ||
      dateAsc_(a.lastUpdated, b.lastUpdated) ||
      nameAsc_(a, b);
  });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return { season: sealSeasonPublic_(), board: rows, generatedAt: new Date().toISOString() };
}

/** Preserve zeroes, normalise numeric Sheets strings, and expose malformed
 * source values honestly instead of presenting them as a real zero floor. */
function masterSealSvFloor_(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  var floor = Number(value);
  return isFinite(floor) && Math.floor(floor) === floor && floor >= 0 && floor <= SV_MAX_FLOOR ? floor : null;
}
