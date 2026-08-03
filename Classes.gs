/**
 * OnlyPaws — class & build catalogue and the persistent class-selection store.
 *
 * The catalogue below is the backend copy of classes.js; a test asserts they
 * are identical. Selections live in a dedicated `Classes` sheet, keyed by the
 * member's account id, so personal class/build data never touches the guild
 * leaderboard projections or the Master Seal totals.
 */
var CLASS_SHEET = 'Classes';
var CLASS_HEADERS = ['SelectionId', 'MemberId', 'EntryType', 'ClassId', 'BuildId', 'Active', 'CreatedAt', 'UpdatedAt'];
var CLASS_SLOT_SHEET = 'ClassSlots';
var CLASS_SLOT_HEADERS = ['MemberId', 'PrimaryClassId', 'PrimaryBuildId', 'SecondaryClassId', 'SecondaryBuildId', 'CreatedAt', 'UpdatedAt'];
var CLASS_COLLECTION_SHEET = 'ClassSelections';
var CLASS_COLLECTION_HEADERS = ['MemberId', 'SelectionsJson', 'CreatedAt', 'UpdatedAt'];

var CLASS_COLOURS = { green: '#58D68D', red: '#F06A78', blue: '#5FA8FF' };

var CLASS_CATALOGUE = [
  { id: 'beat-performer', name: 'Beat Performer', displayName: 'Beat Performer', iconAsset: 'verdant-oracle.png', colour: 'green', colourFamily: 'green', role: 'healer', roleLabel: 'Healer', roleColor: 'green', combatRole: 'healer',
    builds: [{ id: 'main', name: 'Main' }, { id: 'concerto', name: 'Concerto' }] },
  { id: 'frost-mage', name: 'Frost Mage', displayName: 'Frost Mage', iconAsset: 'frost-mage.png', colour: 'red', colourFamily: 'red', role: 'dps', roleLabel: 'DPS', roleColor: 'red', combatRole: 'dps',
    builds: [{ id: 'main', name: 'Main' }, { id: 'frostbeam', name: 'Frostbeam' }, { id: 'icicle', name: 'Icicle' }] },
  { id: 'heavy-guardian', name: 'Heavy Guardian', displayName: 'Heavy Guardian', iconAsset: 'heavy-guardian.png', colour: 'blue', colourFamily: 'blue', role: 'tank', roleLabel: 'Tank', roleColor: 'blue', combatRole: 'tank',
    builds: [{ id: 'main', name: 'Main' }, { id: 'block', name: 'Block' }, { id: 'earthfort', name: 'Earthfort' }] },
  { id: 'marksman', name: 'Marksman', displayName: 'Marksman', iconAsset: 'twin-striker.png', colour: 'red', colourFamily: 'red', role: 'dps', roleLabel: 'DPS', roleColor: 'red', combatRole: 'dps',
    builds: [{ id: 'main', name: 'Main' }, { id: 'falconry', name: 'Falconry' }, { id: 'wildpack', name: 'Wildpack' }] },
  { id: 'shield-knight', name: 'Shield Knight', displayName: 'Shield Knight', iconAsset: 'shield-knight.png', colour: 'blue', colourFamily: 'blue', role: 'tank', roleLabel: 'Tank', roleColor: 'blue', combatRole: 'tank',
    builds: [{ id: 'main', name: 'Main' }, { id: 'shield', name: 'Shield' }, { id: 'recovery', name: 'Recovery' }] },
  { id: 'stormblade', name: 'Stormblade', displayName: 'Stormblade', iconAsset: 'stormblade.png', colour: 'red', colourFamily: 'red', role: 'dps', roleLabel: 'DPS', roleColor: 'red', combatRole: 'dps',
    builds: [{ id: 'main', name: 'Main' }, { id: 'moonstrike', name: 'Moonstrike' }, { id: 'slash', name: 'Slash' }] },
  { id: 'twin-striker', name: 'Twin Striker', displayName: 'Twin Striker', iconAsset: 'beat-performer.png', colour: 'red', colourFamily: 'red', role: 'dps', roleLabel: 'DPS', roleColor: 'red', combatRole: 'dps',
    builds: [{ id: 'main', name: 'Main' }, { id: 'formless', name: 'Formless' }, { id: 'crimson', name: 'Crimson' }] },
  { id: 'verdant-oracle', name: 'Verdant Oracle', displayName: 'Verdant Oracle', iconAsset: 'marksman.png', colour: 'green', colourFamily: 'green', role: 'healer', roleLabel: 'Healer', roleColor: 'green', combatRole: 'healer',
    builds: [{ id: 'main', name: 'Main' }, { id: 'lifebind', name: 'Lifebind' }, { id: 'smite', name: 'Smite' }] },
  { id: 'wind-knight', name: 'Wind Knight', displayName: 'Wind Knight', iconAsset: 'wind-knight.png', colour: 'red', colourFamily: 'red', role: 'dps', roleLabel: 'DPS', roleColor: 'red', combatRole: 'dps',
    builds: [{ id: 'main', name: 'Main' }, { id: 'skyward', name: 'Skyward' }, { id: 'vanguard', name: 'Vanguard' }] }
];

var CLASS_BY_ID = {};
CLASS_CATALOGUE.forEach(function (c) { CLASS_BY_ID[c.id] = c; });

/** Validate a class/build pair against the canonical catalogue. */
function classValidate_(classId, buildId) {
  var c = CLASS_BY_ID[classId];
  if (!c) throw apiError_('VALIDATION', 'Unknown class.');
  var ok = false;
  c.builds.forEach(function (b) { if (b.id === buildId) ok = true; });
  if (!ok) throw apiError_('VALIDATION', 'That build does not belong to ' + c.name + '.');
  return true;
}

function ensureClassSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, CLASS_SHEET, CLASS_HEADERS);
  ensureColumns_(ss.getSheetByName(CLASS_SHEET), CLASS_HEADERS);
}

function ensureClassSlotSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, CLASS_SLOT_SHEET, CLASS_SLOT_HEADERS);
  ensureColumns_(ss.getSheetByName(CLASS_SLOT_SHEET), CLASS_SLOT_HEADERS);
}

function ensureClassCollectionSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, CLASS_COLLECTION_SHEET, CLASS_COLLECTION_HEADERS);
  ensureColumns_(ss.getSheetByName(CLASS_COLLECTION_SHEET), CLASS_COLLECTION_HEADERS);
}

function classRows_(memberId) {
  return readTable_(CLASS_SHEET).rows.filter(function (r) { return String(r.MemberId) === String(memberId); });
}

/** Public class/build entries keyed by member id; collection data wins over legacy rows. */
function classEntriesByMember_() {
  ensureClassSheet_(); ensureClassSlotSheet_(); ensureClassCollectionSheet_();
  var out = {}, collections = readTable_(CLASS_COLLECTION_SHEET).rows, slots = readTable_(CLASS_SLOT_SHEET).rows, legacy = readTable_(CLASS_SHEET).rows;
  collections.forEach(function (r) { try { var entries = JSON.parse(String(r.SelectionsJson || '[]')); out[String(r.MemberId)] = Array.isArray(entries) ? entries.filter(function (x) { try { return classValidate_(String(x.classId), String(x.buildId || x.buildPathId)) && true; } catch (_) { return false; } }).map(function (x) { return { classId: String(x.classId), buildId: String(x.buildId || x.buildPathId) }; }) : []; } catch (_) { out[String(r.MemberId)] = []; } });
  slots.forEach(function (r) { var id = String(r.MemberId); if (out[id]) return; out[id] = [{ classId: String(r.PrimaryClassId), buildId: String(r.PrimaryBuildId) }]; if (r.SecondaryClassId) out[id].push({ classId: String(r.SecondaryClassId), buildId: String(r.SecondaryBuildId) }); });
  legacy.forEach(function (r) { var id = String(r.MemberId); if (out[id]) return; if (!out[id]) out[id] = []; out[id].push({ classId: String(r.ClassId), buildId: String(r.BuildId) }); });
  return out;
}

function classPublic_(r) {
  return {
    id: String(r.SelectionId),
    entryType: String(r.EntryType),
    classId: String(r.ClassId),
    buildId: String(r.BuildId),
    active: truthy_(r.Active),
    createdAt: iso_(r.CreatedAt),
    updatedAt: iso_(r.UpdatedAt)
  };
}

/** All of a member's saved class selections, primary first then secondaries. */
function myClasses_(token) {
  ensureClassSheet_();
  ensureClassSlotSheet_();
  ensureClassCollectionSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var collection = readTable_(CLASS_COLLECTION_SHEET).rows.filter(function (r) { return String(r.MemberId) === String(s.MemberId); })[0];
  if (collection) {
    var entries;
    try { entries = JSON.parse(String(collection.SelectionsJson || '[]')); } catch (_) { entries = []; }
    entries = Array.isArray(entries) ? entries : [];
    return { catalogueVersion: 3, selections: entries.map(function (x, i) { return { id: 'saved-' + i, entryType: i === 0 ? 'primary' : 'secondary', classId: String(x.classId), buildId: String(x.buildId), active: i === 0 }; }), entries: entries.map(function (x) { return { classId: String(x.classId), buildId: String(x.buildId) }; }) };
  }
  var slot = readTable_(CLASS_SLOT_SHEET).rows.filter(function (r) { return String(r.MemberId) === String(s.MemberId); })[0];
  if (slot) {
    var selections = [{ id: 'primary', entryType: 'primary', classId: String(slot.PrimaryClassId), buildId: String(slot.PrimaryBuildId), active: true }];
    if (slot.SecondaryClassId) selections.push({ id: 'secondary', entryType: 'secondary', classId: String(slot.SecondaryClassId), buildId: String(slot.SecondaryBuildId), active: false });
    return { catalogueVersion: 2, selections: selections, entries: selections.map(function (x) { return { classId: x.classId, buildId: x.buildId }; }), slots: { primary: selections[0], secondary: selections[1] || null } };
  }
  var rows = classRows_(s.MemberId).map(classPublic_);
  rows.sort(function (a, b) {
    if (a.entryType !== b.entryType) return a.entryType === 'primary' ? -1 : 1;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  return { catalogueVersion: 1, selections: rows, entries: rows.map(function (r) { return { classId: r.classId, buildId: r.buildId }; }), slots: { primary: rows.filter(function (r) { return r.entryType === 'primary'; })[0] || null, secondary: rows.filter(function (r) { return r.entryType === 'secondary'; })[0] || null } };
}

/** Persist the ordered, complete class/build collection in one locked update. */
function saveClasses_(token, d) {
  ensureClassCollectionSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var entries = d.entries;
  if (!Array.isArray(entries)) throw apiError_('VALIDATION', 'Classes must be a list.');
  var seen = {};
  var clean = entries.map(function (entry, index) {
    if (!entry || typeof entry !== 'object') throw apiError_('VALIDATION', 'Each class entry must be valid.');
    var classId = String(entry.classId || '');
    var buildId = String(entry.buildId || entry.buildPathId || '');
    classValidate_(classId, buildId);
    var key = classId + '|' + buildId;
    if (seen[key]) throw apiError_('DUPLICATE', 'That class and build are already in your list.');
    seen[key] = true;
    // The ordered collection is authoritative: index zero is always primary.
    // Store the role explicitly as well so the spreadsheet remains readable.
    return { classId: classId, buildId: buildId, entryType: index === 0 ? 'primary' : 'secondary' };
  });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var table = readTable_(CLASS_COLLECTION_SHEET);
    var existing = table.rows.filter(function (r) { return String(r.MemberId) === String(s.MemberId); })[0];
    var now = new Date();
    var row = [s.MemberId, JSON.stringify(clean), existing ? existing.CreatedAt : now, now];
    if (existing) classCollectionSheet_().getRange(existing._row, 1, 1, CLASS_COLLECTION_HEADERS.length).setValues([row]);
    else classCollectionSheet_().appendRow(row);
    return myClasses_(token);
  } finally { lock.releaseLock(); }
}

function classCollectionSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CLASS_COLLECTION_SHEET); }

/** Save the complete two-slot editor state in one locked, single-row update. */
function saveClassSlots_(token, d) {
  ensureClassSlotSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var primary = d.primary || {};
  var secondary = d.secondary || null;
  classValidate_(String(primary.classId || ''), String(primary.buildId || ''));
  if (secondary && secondary.classId) {
    classValidate_(String(secondary.classId), String(secondary.buildId || ''));
    if (String(secondary.classId) === String(primary.classId)) throw apiError_('DUPLICATE', 'Primary and Secondary must be different classes.');
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var table = readTable_(CLASS_SLOT_SHEET);
    var existing = table.rows.filter(function (r) { return String(r.MemberId) === String(s.MemberId); })[0];
    var now = new Date();
    var row = [s.MemberId, String(primary.classId), String(primary.buildId), secondary && secondary.classId ? String(secondary.classId) : '', secondary && secondary.classId ? String(secondary.buildId) : '', existing ? existing.CreatedAt : now, now];
    if (existing) classSheetForSlots_().getRange(existing._row, 1, 1, CLASS_SLOT_HEADERS.length).setValues([row]);
    else classSheetForSlots_().appendRow(row);
    return myClasses_(token);
  } finally { lock.releaseLock(); }
}

function classSheetForSlots_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CLASS_SLOT_SHEET); }

function classSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CLASS_SHEET); }

function writeClassCell_(row, header, value) {
  var t = readTable_(CLASS_SHEET), col = t.headers.indexOf(header) + 1;
  if (col > 0) classSheet_().getRange(row._row, col).setValue(value);
}

/** Clear the active flag on every one of a member's selections. */
function clearActive_(memberId) {
  var t = readTable_(CLASS_SHEET);
  t.rows.forEach(function (r) {
    if (String(r.MemberId) === String(memberId) && truthy_(r.Active)) {
      classSheet_().getRange(r._row, t.headers.indexOf('Active') + 1).setValue(false);
    }
  });
}

/** Demote the member's current primary (if any) to secondary. */
function demotePrimary_(memberId, exceptId) {
  var t = readTable_(CLASS_SHEET);
  t.rows.forEach(function (r) {
    if (String(r.MemberId) === String(memberId) && String(r.EntryType) === 'primary' &&
      String(r.SelectionId) !== String(exceptId || '')) {
      classSheet_().getRange(r._row, t.headers.indexOf('EntryType') + 1).setValue('secondary');
    }
  });
}

/**
 * Create or update a class selection.
 *  - entryType 'primary' enforces one-primary-per-user (any existing primary
 *    is demoted, inside the script lock, so the invariant always holds).
 *  - Exact duplicate (same class+build, different row) is rejected.
 *  - A saved selection becomes the active personal-progress configuration.
 */
function saveClass_(token, d) {
  ensureClassSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var entryType = d.entryType === 'primary' ? 'primary' : 'secondary';
  var classId = String(d.classId || '');
  var buildId = String(d.buildId || '');
  classValidate_(classId, buildId);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var mine = classRows_(s.MemberId);
    var editing = d.selectionId ? mine.filter(function (r) { return String(r.SelectionId) === String(d.selectionId); })[0] : null;
    if (d.selectionId && !editing) throw apiError_('NOT_FOUND', 'That class configuration no longer exists.');

    // Reject an exact duplicate class+build on a different row.
    var dup = mine.filter(function (r) {
      return String(r.ClassId) === classId && String(r.BuildId) === buildId &&
        (!editing || String(r.SelectionId) !== String(editing.SelectionId));
    })[0];
    if (dup) throw apiError_('DUPLICATE', 'You already have that class and build saved.');

    var now = new Date();
    if (entryType === 'primary') demotePrimary_(s.MemberId, editing ? editing.SelectionId : null);
    clearActive_(s.MemberId);   // the saved selection becomes active

    var id;
    if (editing) {
      id = String(editing.SelectionId);
      writeClassCell_(editing, 'EntryType', entryType);
      writeClassCell_(editing, 'ClassId', classId);
      writeClassCell_(editing, 'BuildId', buildId);
      writeClassCell_(editing, 'Active', true);
      writeClassCell_(editing, 'UpdatedAt', now);
    } else {
      id = uid_('CLS');
      classSheet_().appendRow([id, s.MemberId, entryType, classId, buildId, true, now, now]);
    }
    return { saved: classPublic_(classRows_(s.MemberId).filter(function (r) { return String(r.SelectionId) === id; })[0]),
      selections: myClasses_(token).selections };
  } finally {
    lock.releaseLock();
  }
}

/** Make one saved selection the active personal-progress configuration. */
function setActiveClass_(token, d) {
  ensureClassSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var target = classRows_(s.MemberId).filter(function (r) { return String(r.SelectionId) === String(d.selectionId); })[0];
    if (!target) throw apiError_('NOT_FOUND', 'That class configuration no longer exists.');
    clearActive_(s.MemberId);
    writeClassCell_(target, 'Active', true);
    writeClassCell_(target, 'UpdatedAt', new Date());
    return { selections: myClasses_(token).selections };
  } finally { lock.releaseLock(); }
}

/** Promote a secondary selection to primary (demoting the old primary). */
function promoteClass_(token, d) {
  ensureClassSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var target = classRows_(s.MemberId).filter(function (r) { return String(r.SelectionId) === String(d.selectionId); })[0];
    if (!target) throw apiError_('NOT_FOUND', 'That class configuration no longer exists.');
    demotePrimary_(s.MemberId, target.SelectionId);
    writeClassCell_(target, 'EntryType', 'primary');
    writeClassCell_(target, 'UpdatedAt', new Date());
    return { selections: myClasses_(token).selections };
  } finally { lock.releaseLock(); }
}

/**
 * Remove a selection. The only primary cannot be removed unless the member
 * has no other selections at all (a valid no-class state). Removing the active
 * selection moves active to the primary (or the first remaining selection).
 */
function deleteClass_(token, d) {
  ensureClassSheet_();
  var s = activeMemberSession_(token); s.MemberId = s.ActiveMemberId;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var mine = classRows_(s.MemberId);
    var target = mine.filter(function (r) { return String(r.SelectionId) === String(d.selectionId); })[0];
    if (!target) throw apiError_('NOT_FOUND', 'That class configuration no longer exists.');
    if (String(target.EntryType) === 'primary' && mine.length > 1) {
      throw apiError_('PRIMARY_REQUIRED', 'Promote another class to primary before removing this one.');
    }
    var wasActive = truthy_(target.Active);
    classSheet_().deleteRow(target._row);
    if (wasActive) {
      var remaining = classRows_(s.MemberId);
      if (remaining.length) {
        var primary = remaining.filter(function (r) { return String(r.EntryType) === 'primary'; })[0] || remaining[0];
        writeClassCell_(primary, 'Active', true);
      }
    }
    return { selections: myClasses_(token).selections };
  } finally { lock.releaseLock(); }
}
