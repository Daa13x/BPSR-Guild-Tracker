/*
 * Deterministically converts an OnlyPaws spreadsheet export into the existing
 * private GitHub state schema. It deliberately excludes authentication and
 * recovery material: Members, Sessions, BackupCodes, LoginAttempts, audit
 * records and the private MemberMap stay out of the generated state files.
 *
 * Usage (with the bundled artifact-tool runtime):
 *   node scripts/import-xlsx-data.mjs <source.xlsx> <output-directory>
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The project does not ship the spreadsheet library to browser builds.  Use
// NODE_PATH with the Codex workspace runtime when invoking this maintenance
// script locally; createRequire keeps that resolution explicit and testable.
const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = require('@oai/artifact-tool');

const [source, outputDirectory] = process.argv.slice(2);
if (!source || !outputDirectory) {
  throw new Error('Usage: import-xlsx-data.mjs <source.xlsx> <output-directory>');
}

const schemaVersion = 1;
const now = new Date().toISOString();
const sourceBlob = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(sourceBlob);
const sheetByName = new Map(workbook.worksheets.items.map(sheet => [sheet.name, sheet]));
const warnings = [];

function asText(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function asBoolean(value) {
  if (value === true || value === 1) return true;
  return /^(true|yes|y|1)$/i.test(asText(value));
}
function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function stablePublicId(memberId) {
  return 'pm-' + crypto.createHash('sha256').update(`pmid:${memberId}`).digest('hex').slice(0, 16);
}
function table(name) {
  const sheet = sheetByName.get(name);
  if (!sheet) { warnings.push(`missing sheet: ${name}`); return []; }
  const used = sheet.getUsedRange(true);
  const values = used ? used.values : [];
  if (!values.length) return [];
  const headers = values[0].map(asText);
  return values.slice(1).filter(row => row.some(value => asText(value) !== '')).map((row, index) => {
    const record = { _row: index + 2 };
    headers.forEach((header, column) => { if (header) record[header] = row[column]; });
    return record;
  });
}
function writeJson(relative, value) {
  const target = path.join(outputDirectory, relative);
  return fs.mkdir(path.dirname(target), { recursive: true }).then(() => fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8'));
}
function rejectPrivate(value, location = 'root') {
  const forbidden = /(backup|recovery|password|pin|token|session|secret|credential|email|memberid(?!$)|hash|salt|audit|login)/i;
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectPrivate(entry, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'publicMemberId' && forbidden.test(key)) throw new Error(`private key in generated state: ${location}.${key}`);
    rejectPrivate(entry, `${location}.${key}`);
  }
}

const memberMap = new Map(table('MemberMap').map(row => [asText(row.MemberId), asText(row.PublicMemberId)]).filter(([id, publicId]) => id && publicId));
const members = table('Members');
const players = new Map(table('Players').map(row => [asText(row.UserId), row]).filter(([id]) => id));
const sealRows = table('MasterSeal');
const selections = table('ClassSelections');
const legacyClasses = table('Classes');
const links = table('AccountLinks').filter(row => !asText(row.UnlinkedAt));
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const seasonPath = path.resolve(scriptDirectory, '../data/master-seal.json');
const season = JSON.parse(await fs.readFile(seasonPath, 'utf8'));
const dungeonDefinitions = Array.isArray(season.dungeons) ? season.dungeons : [];

const selectionsByMember = new Map();
for (const row of selections) {
  const memberId = asText(row.MemberId);
  if (!memberId || !asText(row.SelectionsJson)) continue;
  try {
    const parsed = JSON.parse(asText(row.SelectionsJson));
    const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.entries) ? parsed.entries : []);
    selectionsByMember.set(memberId, entries.map(entry => ({ classId: asText(entry.classId), buildId: asText(entry.buildId) })).filter(entry => entry.classId && entry.buildId));
  } catch (_) { warnings.push(`invalid class selection JSON at row ${row._row}`); }
}
for (const row of legacyClasses) {
  const memberId = asText(row.MemberId);
  if (!memberId || selectionsByMember.has(memberId)) continue;
  const entry = { classId: asText(row.ClassId), buildId: asText(row.BuildId) };
  if (entry.classId && entry.buildId) selectionsByMember.set(memberId, [entry]);
}

const sealByMember = new Map();
for (const row of sealRows) {
  const memberId = asText(row.MemberId);
  const dungeonId = asText(row.DungeonId);
  if (!memberId || !dungeonId) continue;
  if (!sealByMember.has(memberId)) sealByMember.set(memberId, new Map());
  sealByMember.get(memberId).set(dungeonId, {
    dungeonId,
    bestMasterLevel: asText(row.BestMasterLevel) || null,
    points: asNumber(row.Points),
    cleared: asBoolean(row.Cleared)
  });
}

function relationFor(memberId) {
  const incoming = links.find(link => asText(link.AltMemberId) === memberId);
  const outgoing = links.filter(link => asText(link.MainMemberId) === memberId);
  return {
    role: outgoing.length ? 'main' : (incoming ? 'alt' : 'solo'),
    mainPublicId: memberMap.get(incoming ? asText(incoming.MainMemberId) : memberId) || stablePublicId(incoming ? asText(incoming.MainMemberId) : memberId),
    altPublicIds: outgoing.map(link => memberMap.get(asText(link.AltMemberId)) || stablePublicId(asText(link.AltMemberId)))
  };
}
function memberFile(member) {
  const memberId = asText(member.MemberId);
  const player = players.get(memberId) || {};
  const dungeonRows = sealByMember.get(memberId) || new Map();
  const dungeons = dungeonDefinitions.map(def => dungeonRows.get(def.id) || {
    dungeonId: def.id, bestMasterLevel: null, points: 0, cleared: false
  });
  const totalScore = dungeons.reduce((sum, dungeon) => sum + (dungeon.cleared ? asNumber(dungeon.points) : 0), 0);
  return {
    schemaVersion,
    publicMemberId: memberMap.get(memberId) || stablePublicId(memberId),
    characterName: asText(member.CharacterName),
    profile: { verified: asBoolean(player.Verified), hidden: asBoolean(player.Hidden), disabled: Boolean(asText(member.DisabledAt)) },
    classes: selectionsByMember.get(memberId) || [],
    account: relationFor(memberId),
    stimVault: { floors: Math.max(0, Math.min(60, asNumber(player.SVFloor))) },
    masterSeal: { dungeons },
    difficulty: { easy: asBoolean(player.EasyComplete), hard: asBoolean(player.HardComplete), master: asBoolean(player.MasterComplete) },
    nmRaidCompleted: false,
    easyHardRaidCompleted: asBoolean(player.RaidComplete),
    raidResetPeriod: null,
    stimVaultResetPeriod: null,
    updatedAt: asIso(player.LastUpdated) || asIso(member.LastAccessAt) || now,
    dataRevision: 1,
    _derived: { totalScore }
  };
}

const files = members.map(memberFile);
const boardRows = files.filter(file => !file.profile.disabled).map(file => {
  const dungeons = file.masterSeal.dungeons;
  const totalScore = file._derived.totalScore;
  return {
    publicMemberId: file.publicMemberId,
    name: file.characterName,
    verified: file.profile.verified,
    hidden: file.profile.hidden,
    classes: file.classes,
    svFloor: file.stimVault.floors,
    nmRaid: file.nmRaidCompleted,
    easyHardRaid: file.easyHardRaidCompleted,
    dungeons,
    totalScore,
    remainingScore: Math.max(0, 3650 - totalScore),
    progressPercent: Math.min(100, Math.max(0, Math.round(totalScore / 3650 * 100))),
    clearedCount: dungeons.filter(dungeon => dungeon.cleared).length,
    mountUnlocked: totalScore >= 3650,
    lastUpdated: file.updatedAt
  };
});
boardRows.sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name));
boardRows.forEach((row, index) => { row.rank = index + 1; });
files.forEach(file => { delete file._derived; rejectPrivate(file, `member:${file.publicMemberId}`); });
rejectPrivate(boardRows, 'board');

const schema = {
  schemaVersion,
  describes: 'OnlyPaws Tracker non-private state imported from XLSX',
  memberFields: ['schemaVersion', 'publicMemberId', 'characterName', 'profile', 'classes', 'account', 'stimVault', 'masterSeal', 'difficulty', 'nmRaidCompleted', 'easyHardRaidCompleted', 'raidResetPeriod', 'stimVaultResetPeriod', 'updatedAt', 'dataRevision']
};
const manifest = { schemaVersion, generatedAt: now, memberCount: files.length, board: 'state/board.json', source: 'BPSR Guild Tracker Data.xlsx' };
const board = { schemaVersion, generatedAt: now, season: season.season || {}, rows: boardRows };
await Promise.all([
  writeJson('state/schema.json', schema),
  writeJson('state/manifest.json', manifest),
  writeJson('state/board.json', board),
  ...files.map(file => writeJson(`state/members/${file.publicMemberId}.json`, file))
]);
console.log(JSON.stringify({
  source: path.basename(source), membersRead: members.length, membersWritten: files.length,
  boardRows: boardRows.length, warnings, generatedPaths: 3 + files.length
}, null, 2));
