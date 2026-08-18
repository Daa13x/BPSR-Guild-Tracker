/**
 * Discord.gs — server-to-server actions for the OnlyPaws Discord bot.
 *
 * The bot is another INTERFACE onto this tracker, never a separate copy of the
 * data. It authenticates with a shared secret (Script Property
 * BOT_SHARED_SECRET) and identifies a member by a private DiscordId -> MemberId
 * link established with a website-generated, single-use link code — so the bot
 * never handles a backup code. All reads/writes go through the existing
 * storage-mode-aware paths; the backend always recomputes scores.
 *
 * Security invariants (do not weaken):
 *  - Every bot action calls botAuth_ first; a bad/missing secret is FORBIDDEN.
 *  - The secret is read only from Script Properties and is never returned,
 *    logged, or echoed. The DiscordLinks/DiscordLinkCodes sheets are PRIVATE
 *    (Sheets only) and never written to GitHub.
 *  - Actions only ever touch the resolved member's own progression (and their
 *    linked alts). publicMemberId is exposed to the bot; raw member ids are not.
 */

var DISCORD_LINKS_SHEET = 'DiscordLinks';                 // PRIVATE: DiscordId -> MemberId
var DISCORD_LINKS_HEADERS = ['DiscordId', 'MemberId', 'DiscordTag', 'LinkedAt'];
var DISCORD_CODES_SHEET = 'DiscordLinkCodes';             // PRIVATE: single-use link codes
var DISCORD_CODES_HEADERS = ['Code', 'MemberId', 'ExpiresAt', 'UsedAt', 'CreatedAt'];
var DISCORD_CODE_TTL_MS = 10 * 60 * 1000;                 // link codes expire in 10 minutes
var DISCORD_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';  // no ambiguous 0/O/1/I/L

function ensureDiscordSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, DISCORD_LINKS_SHEET, DISCORD_LINKS_HEADERS);
  ensureColumns_(ss.getSheetByName(DISCORD_LINKS_SHEET), DISCORD_LINKS_HEADERS);
  ensureSheet_(ss, DISCORD_CODES_SHEET, DISCORD_CODES_HEADERS);
  ensureColumns_(ss.getSheetByName(DISCORD_CODES_SHEET), DISCORD_CODES_HEADERS);
}

/** Reject any bot request whose shared secret does not match Script Properties.
 * Compares SHA-256 hashes with the shared constant-time primitive (equal_), so
 * the raw secret is never compared byte-by-byte or leaked via timing. An unset
 * BOT_SHARED_SECRET fails closed. */
function botAuth_(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('BOT_SHARED_SECRET') || '';
  var provided = (data && data.botSecret) || '';
  if (!expected || !equal_(hash_(String(provided)), hash_(String(expected)))) {
    throw apiError_('FORBIDDEN', 'Bot authorization failed.');
  }
}

/** A single-use link code, from cryptographic entropy (a UUID digest), mapped
 * to an unambiguous alphabet — never Math.random(), which is not a CSPRNG. */
function discordCode_() {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  var out = '';
  for (var i = 0; i < 8; i++) out += DISCORD_CODE_ALPHABET.charAt((digest[i] & 255) % DISCORD_CODE_ALPHABET.length);
  return out;
}

/** The active DiscordLinks row for a Discord id, or null. */
function discordLinkRow_(discordId) {
  ensureDiscordSheets_();
  return readTable_(DISCORD_LINKS_SHEET).rows.filter(function (r) { return String(r.DiscordId) === String(discordId); })[0] || null;
}

/** Resolve a Discord id to its linked member id, or throw NOT_LINKED. */
function discordMemberId_(discordId) {
  var row = discordLinkRow_(discordId);
  if (!row || !row.MemberId) throw apiError_('NOT_LINKED', 'This Discord account is not linked to a tracker character.');
  var m = member_(String(row.MemberId));
  if (!m || m.DisabledAt) throw apiError_('NOT_LINKED', 'The linked tracker character is unavailable.');
  return String(row.MemberId);
}

// ---------------------------------------------------------------------------
// Website-authenticated: mint a single-use link code (member session token)
// ---------------------------------------------------------------------------
function createDiscordLinkCode_(token) {
  var memberId = activeMemberId_(token);
  ensureDiscordSheets_();
  var now = new Date(), expires = new Date(now.getTime() + DISCORD_CODE_TTL_MS);
  var code = discordCode_();
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DISCORD_CODES_SHEET)
    .appendRow([code, String(memberId), expires, '', now]);
  audit_(String(memberId), 'DISCORD_LINK_CODE', String(memberId), 'Issued a Discord link code');
  return { code: code, expiresAt: expires.toISOString() };
}

// ---------------------------------------------------------------------------
// Bot-authenticated actions
// ---------------------------------------------------------------------------

/** Complete a link with a website-generated code. Consumes the code. The
 * check-then-consume runs under a script lock so a code is atomically single
 * use even under concurrent redemptions. */
function discordLink_(data) {
  botAuth_(data);
  ensureDiscordSheets_();
  var code = String((data && data.code) || '').trim().toUpperCase();
  var discordId = String((data && data.discordId) || '').trim();
  if (!code || !discordId) throw apiError_('VALIDATION', 'A link code and Discord id are required.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return discordLinkUnlocked_(code, discordId, String((data && data.discordTag) || ''));
  } finally {
    lock.releaseLock();
  }
}

function discordLinkUnlocked_(code, discordId, tag) {
  var table = readTable_(DISCORD_CODES_SHEET);
  var codeRow = table.rows.filter(function (r) { return String(r.Code).toUpperCase() === code; })[0];
  if (!codeRow) throw apiError_('INVALID_CODE', 'That link code is not valid.');
  if (codeRow.UsedAt) throw apiError_('INVALID_CODE', 'That link code has already been used.');
  if (new Date(codeRow.ExpiresAt).getTime() < Date.now()) throw apiError_('INVALID_CODE', 'That link code has expired. Generate a new one on the website.');

  var memberId = String(codeRow.MemberId);
  var m = member_(memberId);
  if (!m || m.DisabledAt) throw apiError_('NOT_FOUND', 'The character for that code is unavailable.');

  // Upsert the DiscordId -> MemberId link (one character per Discord id).
  var links = readTable_(DISCORD_LINKS_SHEET);
  var linkSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DISCORD_LINKS_SHEET);
  var existing = links.rows.filter(function (r) { return String(r.DiscordId) === discordId; })[0];
  var now = new Date();
  if (existing) {
    linkSheet.getRange(existing._row, 1, 1, DISCORD_LINKS_HEADERS.length).setValues([[discordId, memberId, tag, now]]);
  } else {
    linkSheet.appendRow([discordId, memberId, tag, now]);
  }
  // Consume the code (single use).
  table.sheet.getRange(codeRow._row, table.headers.indexOf('UsedAt') + 1).setValue(now);
  audit_(memberId, 'DISCORD_LINK', discordId, 'Linked a Discord account');
  return { characterName: String(m.CharacterName || '') };
}

function discordUnlink_(data) {
  botAuth_(data);
  var discordId = String((data && data.discordId) || '').trim();
  var row = discordLinkRow_(discordId);
  if (row) {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DISCORD_LINKS_SHEET).deleteRow(row._row);
    audit_(String(row.MemberId), 'DISCORD_UNLINK', discordId, 'Unlinked a Discord account');
  }
  return { ok: true };
}

function discordWhoami_(data) {
  botAuth_(data);
  var row = discordLinkRow_(String((data && data.discordId) || '').trim());
  if (!row || !row.MemberId) return { linked: false };
  var m = member_(String(row.MemberId));
  if (!m || m.DisabledAt) return { linked: false };
  return { linked: true, characterName: String(m.CharacterName || '') };
}

/** Storage-mode-aware Master Seal read for a resolved member (mirrors
 * myMasterSeal_ but keyed by member id). Applies the load-time resets. */
function masterSealForMember_(memberId) {
  if (storageMode_() === 'github') return githubMyMasterSeal_(memberId);
  var stim = stimVaultPublic_(memberId);                 // applies the biweekly reset
  var mine = sealRowsByMember_()[String(memberId)];
  var dungeons = sealProgress_(mine);
  return {
    season: sealSeasonPublic_(), dungeons: dungeons, totals: sealTotals_(dungeons),
    stimVault: stim, difficulty: sealDifficultyPublic_(memberId)   // applies the weekly raid reset
  };
}

/** The bot-facing progression shape for a member. */
function discordProgressShape_(memberId) {
  var m = member_(memberId);
  var ms = masterSealForMember_(memberId);
  var diff = ms.difficulty || {};
  return {
    characterName: m ? String(m.CharacterName || '') : '',
    stimVaultFloor: ms.stimVault ? (Number(ms.stimVault.points) || 0) : 0,
    nmRaidCompleted: Boolean(diff.nmRaidCompleted),
    easyHardRaidCompleted: Boolean(diff.easyHardRaidCompleted),
    difficulty: { easy: Boolean(diff.easy), hard: Boolean(diff.hard), master: Boolean(diff.master) },
    dungeons: (ms.dungeons || []).map(function (x) {
      return { dungeonId: x.dungeonId, bestMasterLevel: x.bestMasterLevel, points: x.points, cleared: x.cleared };
    }),
    totals: ms.totals
  };
}

function discordProgress_(data) {
  botAuth_(data);
  return discordProgressShape_(discordMemberId_(String((data && data.discordId) || '').trim()));
}

/**
 * Apply a partial progression patch for a linked member. The patch is merged
 * onto current state (difficulty needs all five booleans; an uncleared dungeon
 * may hold no points/level), then written via the existing storage-mode-aware
 * path, which recomputes every score.
 */
function discordUpdate_(data) {
  botAuth_(data);
  var memberId = discordMemberId_(String((data && data.discordId) || '').trim());
  var patch = (data && data.patch) || {};
  if (typeof patch !== 'object') throw apiError_('VALIDATION', 'patch must be an object.');
  var current = discordProgressShape_(memberId);
  var d = {};

  // Stim Vault floor — only when it actually changes (so an idempotent bot
  // call does not force a redundant write / GitHub commit).
  if (patch.stimVaultFloor !== undefined && patch.stimVaultFloor !== null && patch.stimVaultFloor !== '') {
    var floor = integer_(patch.stimVaultFloor, 0, SV_MAX_FLOOR);
    if (floor !== current.stimVaultFloor) d.stimVault = { points: floor };
  }

  // Difficulty — sealDifficultyWrite_ needs all five booleans, so merge the
  // patched keys onto the current state; only send it if something changed.
  var diffKeys = ['easy', 'hard', 'master', 'nmRaidCompleted', 'easyHardRaidCompleted'];
  var cur = { easy: current.difficulty.easy, hard: current.difficulty.hard, master: current.difficulty.master,
    nmRaidCompleted: current.nmRaidCompleted, easyHardRaidCompleted: current.easyHardRaidCompleted };
  var merged = { easy: cur.easy, hard: cur.hard, master: cur.master, nmRaidCompleted: cur.nmRaidCompleted, easyHardRaidCompleted: cur.easyHardRaidCompleted };
  var diffChanged = false;
  diffKeys.forEach(function (k) {
    if (typeof patch[k] === 'boolean') { merged[k] = patch[k]; if (patch[k] !== cur[k]) diffChanged = true; }
  });
  if (diffChanged) d.difficulty = merged;

  // Dungeon — normalise to the sealValidateEntry_ invariants (an uncleared
  // dungeon holds no level/points). masterLevel <= 0 clears; any points or a
  // positive level marks it cleared. Only send it if the result differs.
  if (patch.dungeon && typeof patch.dungeon === 'object') {
    var id = String(patch.dungeon.id || '');
    var cd = current.dungeons.filter(function (x) { return String(x.dungeonId) === id; })[0] || { bestMasterLevel: null, points: 0, cleared: false };
    var curLevel = cd.bestMasterLevel === undefined || cd.bestMasterLevel === null ? null : Number(cd.bestMasterLevel);
    var curPoints = Number(cd.points) || 0;
    var level = patch.dungeon.masterLevel === undefined ? (curLevel || 0)
      : Math.min(Math.max(0, Math.floor(Number(patch.dungeon.masterLevel) || 0)), MASTER_SEAL_SEASON.maxMasterLevel);
    var points = patch.dungeon.points === undefined ? curPoints : integer_(patch.dungeon.points, 0, MASTER_SEAL_SEASON.maxScore);
    var cleared = typeof patch.dungeon.cleared === 'boolean' ? patch.dungeon.cleared : (level > 0 || points > 0);
    var entry = cleared
      ? { bestMasterLevel: level > 0 ? level : null, points: points, cleared: true }
      : { bestMasterLevel: null, points: 0, cleared: false };
    var same = (entry.bestMasterLevel === (curLevel === undefined ? null : curLevel)) &&
      (entry.points === curPoints) && (entry.cleared === Boolean(cd.cleared));
    if (!same) { d.dungeons = {}; d.dungeons[id] = entry; }
  }

  if (Object.keys(d).length) masterSealUpdateForStorageMode_(null, d, memberId);
  return discordProgressShape_(memberId);
}

/** The account group for a member (root + linked alts), expressed with public
 * ids. Marks which one the Discord link currently points to as active. */
function discordAccounts_(data) {
  botAuth_(data);
  var activeId = discordMemberId_(String((data && data.discordId) || '').trim());
  var group = discordGroupIds_(activeId);
  return {
    accounts: group.ids.map(function (id) {
      var m = member_(id);
      return {
        characterName: m ? String(m.CharacterName || '') : '',
        role: id === group.root ? 'main' : 'alt',
        active: id === activeId,
        memberPublicId: publicIdFor_(id)
      };
    }).filter(function (a) { return a.characterName; })
  };
}

function discordSwitchAccount_(data) {
  botAuth_(data);
  var discordId = String((data && data.discordId) || '').trim();
  var activeId = discordMemberId_(discordId);
  var wanted = String((data && data.memberPublicId) || '').trim();
  if (!wanted) throw apiError_('VALIDATION', 'A target character is required.');
  var group = discordGroupIds_(activeId);
  var targetId = group.ids.filter(function (id) { return publicIdFor_(id) === wanted; })[0];
  if (!targetId) throw apiError_('FORBIDDEN', 'That character is not in your linked account group.');
  var m = member_(targetId);
  if (!m || m.DisabledAt) throw apiError_('NOT_FOUND', 'That character is unavailable.');
  var row = discordLinkRow_(discordId);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DISCORD_LINKS_SHEET)
    .getRange(row._row, DISCORD_LINKS_HEADERS.indexOf('MemberId') + 1).setValue(targetId);
  audit_(targetId, 'DISCORD_SWITCH', discordId, 'Switched active linked character');
  return { characterName: String(m.CharacterName || '') };
}

/**
 * The account ids a Discord-linked member may manage. Mirrors the website's
 * boundary: a MAIN (no incoming Alt link) manages itself and its alts; an ALT
 * manages ONLY itself — it never gains read/write over its main or siblings.
 * Without a session the bot cannot rely on the per-session AccountGroupAccess
 * grant, so it takes the conservative alt-alone default.
 */
function discordGroupIds_(memberId) {
  var id = String(memberId);
  if (incomingAccountLink_(id)) return { root: id, ids: [id] };   // an alt manages only itself
  var ids = [id];
  outgoingAccountLinks_(id).forEach(function (r) { ids.push(String(r.AltMemberId)); });
  return { root: id, ids: ids };
}
