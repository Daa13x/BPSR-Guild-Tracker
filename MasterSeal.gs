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

/** Own progress for the signed-in member. */
function myMasterSeal_(token) {
  var s = session_(token, 'member');
  var mine = sealRowsByMember_()[String(s.MemberId)];
  var dungeons = sealProgress_(mine);
  return { season: sealSeasonPublic_(), dungeons: dungeons, totals: sealTotals_(dungeons) };
}

function masterSealUpdate_(token, d) {
  var s = session_(token, 'member');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var changed = sealWrite_(s.MemberId, d.dungeons);
    var mine = sealRowsByMember_()[String(s.MemberId)];
    var dungeons = sealProgress_(mine);
    return { changed: changed, dungeons: dungeons, totals: sealTotals_(dungeons) };
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
function masterSealBoard_() {
  var grouped = sealRowsByMember_();
  var rows = [];
  readTable_(AUTH_SHEETS.MEMBERS).rows.forEach(function (m) {
    if (m.DisabledAt) return;
    var dungeons = sealProgress_(grouped[String(m.MemberId)]);
    var totals = sealTotals_(dungeons);
    rows.push({
      name: String(m.CharacterName),
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
