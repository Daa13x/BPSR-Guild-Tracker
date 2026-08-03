const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

function member(c, name) {
  const a = call(c, 'createAccount', { characterName: name });
  return a.session.token;
}
function primaryOf(sel) { return sel.filter(s => s.entryType === 'primary'); }
function activeOf(sel) { return sel.filter(s => s.active); }

test('a new member has no class selections', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  assert.equal(call(c, 'myClasses', { token: t }).selections.length, 0);
});

test('two slots save together, reload together, and allow an empty Secondary', () => {
  const c = runtime(); const t = member(c, 'Dax');
  let r = call(c, 'saveClassSlots', { token: t, primary: { classId: 'stormblade', buildId: 'slash' }, secondary: { classId: 'frost-mage', buildId: 'icicle' } });
  assert.equal(r.slots.primary.classId, 'stormblade');
  assert.equal(r.slots.secondary.classId, 'frost-mage');
  assert.equal(c.__sheets.ClassSlots.rows.length, 2, 'one header plus one atomic member record');
  r = call(c, 'saveClassSlots', { token: t, primary: { classId: 'marksman', buildId: 'falconry' }, secondary: null });
  assert.equal(r.slots.primary.classId, 'marksman'); assert.equal(r.slots.secondary, null);
  const restored = call(c, 'myClasses', { token: t });
  assert.equal(restored.slots.primary.classId, 'marksman'); assert.equal(restored.slots.secondary, null);
  assert.equal(c.__sheets.ClassSlots.rows.length, 2, 'update replaces the complete slot row');
});

test('two slots reject duplicate stable class IDs and keep saved state intact', () => {
  const c = runtime(); const t = member(c, 'Dax');
  call(c, 'saveClassSlots', { token: t, primary: { classId: 'stormblade', buildId: 'slash' }, secondary: { classId: 'frost-mage', buildId: 'icicle' } });
  assert.throws(() => call(c, 'saveClassSlots', { token: t, primary: { classId: 'stormblade', buildId: 'main' }, secondary: { classId: 'stormblade', buildId: 'slash' } }), /different classes/);
  const r = call(c, 'myClasses', { token: t });
  assert.equal(r.slots.primary.classId, 'stormblade'); assert.equal(r.slots.secondary.classId, 'frost-mage');
});

test('legacy one-class records remain readable until the member uses the two-slot editor', () => {
  const c = runtime(); const t = member(c, 'Dax');
  call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'slash' });
  const r = call(c, 'myClasses', { token: t });
  assert.equal(r.slots.primary.classId, 'stormblade'); assert.equal(r.slots.secondary, null);
});

test('saving a primary stores it, makes it active, and enforces one primary per user', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  let r = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' });
  assert.equal(r.saved.entryType, 'primary');
  assert.equal(r.saved.classId, 'stormblade');
  assert.equal(r.saved.buildId, 'moonstrike');
  assert.equal(r.saved.active, true);
  assert.equal(primaryOf(r.selections).length, 1);

  // Saving another primary demotes the first — never two primaries.
  r = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'frost-mage', buildId: 'icicle' });
  assert.equal(primaryOf(r.selections).length, 1, 'exactly one primary');
  assert.equal(primaryOf(r.selections)[0].classId, 'frost-mage');
  assert.equal(activeOf(r.selections).length, 1, 'exactly one active');
});

test('multiple secondaries coexist with the primary; the newest save is active', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' });
  call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'frost-mage', buildId: 'frostbeam' });
  const r = call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'marksman', buildId: 'falconry' });
  assert.equal(r.selections.length, 3);
  assert.equal(primaryOf(r.selections).length, 1);
  assert.equal(activeOf(r.selections).length, 1);
  assert.equal(activeOf(r.selections)[0].classId, 'marksman', 'latest save is active');
});

test('the server rejects invalid class/build combinations', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  assert.throws(() => call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'frost-mage', buildId: 'moonstrike' }), /does not belong/);
  assert.throws(() => call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'nope', buildId: 'main' }), /Unknown class/);
});

test('exact duplicate class + build is rejected', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' });
  assert.throws(() => call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'stormblade', buildId: 'moonstrike' }), /already have/);
  // A different build of the same class is allowed.
  const r = call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'stormblade', buildId: 'slash' });
  assert.equal(r.selections.length, 2);
});

test('editing a selection changes its build without creating a new row', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  const first = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  const r = call(c, 'saveClass', { token: t, selectionId: first.id, entryType: 'primary', classId: 'stormblade', buildId: 'slash' });
  assert.equal(r.selections.length, 1);
  assert.equal(r.saved.id, first.id);
  assert.equal(r.saved.buildId, 'slash');
});

test('switching the active configuration moves the active flag exactly once', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  const p = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'frost-mage', buildId: 'frostbeam' });
  const r = call(c, 'setActiveClass', { token: t, selectionId: p.id });
  assert.equal(activeOf(r.selections).length, 1);
  assert.equal(activeOf(r.selections)[0].id, p.id);
});

test('promoting a secondary swaps primary safely', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  const p = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  const sec = call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'frost-mage', buildId: 'frostbeam' }).saved;
  const r = call(c, 'promoteClass', { token: t, selectionId: sec.id });
  assert.equal(primaryOf(r.selections).length, 1);
  assert.equal(primaryOf(r.selections)[0].id, sec.id);
  const oldPrimary = r.selections.filter(s => s.id === p.id)[0];
  assert.equal(oldPrimary.entryType, 'secondary', 'old primary becomes secondary');
});

test('a secondary can be removed; the only primary cannot while others exist', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  const p = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  const sec = call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'frost-mage', buildId: 'frostbeam' }).saved;
  assert.throws(() => call(c, 'deleteClass', { token: t, selectionId: p.id }), /Promote another/);
  const r = call(c, 'deleteClass', { token: t, selectionId: sec.id });
  assert.equal(r.selections.length, 1);
  // With only the primary left, removing it is allowed (valid no-class state).
  const empty = call(c, 'deleteClass', { token: t, selectionId: p.id });
  assert.equal(empty.selections.length, 0);
});

test('removing the active selection re-homes active to the primary', () => {
  const c = runtime();
  const t = member(c, 'Dax');
  const p = call(c, 'saveClass', { token: t, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  const sec = call(c, 'saveClass', { token: t, entryType: 'secondary', classId: 'frost-mage', buildId: 'frostbeam' }).saved;
  // sec is active (latest save); deleting it should activate the primary.
  const r = call(c, 'deleteClass', { token: t, selectionId: sec.id });
  assert.equal(activeOf(r.selections).length, 1);
  assert.equal(activeOf(r.selections)[0].id, p.id);
});

test('a member cannot mutate another member selections', () => {
  const c = runtime();
  const dax = member(c, 'Dax');
  const aria = member(c, 'Aria');
  const daxSel = call(c, 'saveClass', { token: dax, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' }).saved;
  // Aria references Dax's selection id: it is simply not found under Aria.
  assert.throws(() => call(c, 'setActiveClass', { token: aria, selectionId: daxSel.id }), /no longer exists/);
  assert.throws(() => call(c, 'deleteClass', { token: aria, selectionId: daxSel.id }), /no longer exists/);
  assert.equal(call(c, 'myClasses', { token: dax }).selections.length, 1, "Dax's selection is untouched");
});

test('class selections persist across a fresh session and never touch the leaderboard', () => {
  const c = runtime();
  const dax = member(c, 'Dax');
  call(c, 'saveClass', { token: dax, entryType: 'primary', classId: 'stormblade', buildId: 'moonstrike' });
  // A guild leaderboard read carries no class fields.
  const board = call(c, 'leaderboard', {});
  assert.equal(JSON.stringify(board).includes('stormblade'), false, 'classes never appear in guild data');
  // A separate session for the same member still sees the selection.
  const restored = call(c, 'myClasses', { token: dax });
  assert.equal(restored.selections.length, 1);
  assert.equal(restored.selections[0].classId, 'stormblade');
});

test('the class actions require a valid session', () => {
  const c = runtime();
  assert.throws(() => call(c, 'myClasses', { token: 'nope' }), /Session/);
  assert.throws(() => call(c, 'saveClass', { token: 'nope', entryType: 'primary', classId: 'stormblade', buildId: 'main' }), /Session/);
});
