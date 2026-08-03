const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const STATIC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'classes.json'), 'utf8'));
const FRONTEND = require(path.join(ROOT, 'classes.js'));
FRONTEND.install(STATIC);

/** Load the backend catalogue out of Classes.gs in a bare sandbox. */
function backendCatalogue() {
  const ctx = { Object, Array, String };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, 'Classes.gs'), 'utf8');
  // Only evaluate the catalogue/colour declarations, not the sheet functions.
  const slice = src.slice(0, src.indexOf('var CLASS_BY_ID'));
  vm.runInContext(slice + '\nthis.__cat = CLASS_CATALOGUE; this.__col = CLASS_COLOURS;', ctx);
  return { catalogue: ctx.__cat, colours: ctx.__col };
}

const EXPECTED = {
  'beat-performer': { name: 'Beat Performer', colour: 'green', builds: ['main', 'concerto'] },
  'frost-mage': { name: 'Frost Mage', colour: 'red', builds: ['main', 'frostbeam', 'icicle'] },
  'heavy-guardian': { name: 'Heavy Guardian', colour: 'blue', builds: ['main', 'block', 'earthfort'] },
  'marksman': { name: 'Marksman', colour: 'red', builds: ['main', 'falconry', 'wildpack'] },
  'shield-knight': { name: 'Shield Knight', colour: 'blue', builds: ['main', 'shield', 'recovery'] },
  'stormblade': { name: 'Stormblade', colour: 'red', builds: ['main', 'moonstrike', 'slash'] },
  'twin-striker': { name: 'Twin Striker', colour: 'red', builds: ['main', 'formless', 'crimson'] },
  'verdant-oracle': { name: 'Verdant Oracle', colour: 'green', builds: ['main', 'lifebind', 'smite'] },
  'wind-knight': { name: 'Wind Knight', colour: 'red', builds: ['main', 'skyward', 'vanguard'] }
};
const ORDER = ['beat-performer', 'frost-mage', 'heavy-guardian', 'marksman', 'shield-knight',
  'stormblade', 'twin-striker', 'verdant-oracle', 'wind-knight'];

test('the canonical catalogue has exactly the nine classes in the required order', () => {
  assert.deepEqual(FRONTEND.catalogue.map(c => c.id), ORDER);
});

test('every class has the exact name, colour and build paths', () => {
  FRONTEND.catalogue.forEach(c => {
    const e = EXPECTED[c.id];
    assert.ok(e, 'unexpected class ' + c.id);
    assert.equal(c.name, e.name);
    assert.equal(c.colour, e.colour);
    assert.deepEqual(c.builds.map(b => b.id), e.builds, c.id + ' builds');
    // Build display names are the capitalised id, and Main leads.
    assert.equal(c.builds[0].id, 'main');
  });
});

test('Beat Performer has only Main and Concerto', () => {
  const bp = FRONTEND.getClass('beat-performer');
  assert.deepEqual(bp.builds.map(b => b.id), ['main', 'concerto']);
});

test('colour tokens map each class to red, blue or green', () => {
  assert.deepEqual(FRONTEND.colours, { green: '#58D68D', red: '#F06A78', blue: '#5FA8FF' });
  assert.equal(FRONTEND.colourHex('stormblade'), '#F06A78');
  assert.equal(FRONTEND.colourHex('heavy-guardian'), '#5FA8FF');
  assert.equal(FRONTEND.colourHex('verdant-oracle'), '#58D68D');
});

test('every class and build inherits the canonical combat role metadata', () => {
  const expected = {
    'frost-mage': ['dps', 'DPS', 'red'], marksman: ['dps', 'DPS', 'red'], 'twin-striker': ['dps', 'DPS', 'red'], stormblade: ['dps', 'DPS', 'red'], 'wind-knight': ['dps', 'DPS', 'red'],
    'shield-knight': ['tank', 'Tank', 'blue'], 'heavy-guardian': ['tank', 'Tank', 'blue'],
    'beat-performer': ['healer', 'Healer', 'green'], 'verdant-oracle': ['healer', 'Healer', 'green']
  };
  FRONTEND.catalogue.forEach(c => {
    assert.deepEqual([c.combatRole, c.roleLabel, c.roleColor], expected[c.id], c.id);
    c.builds.forEach(build => assert.equal(FRONTEND.validate(c.id, build.id).class.combatRole, c.combatRole));
  });
});

test('the icon mapping covers every class and points at repo assets that exist', () => {
  ORDER.forEach(id => {
    assert.ok(FRONTEND.iconSource[id], 'missing icon source for ' + id);
    const p = path.join(ROOT, FRONTEND.iconPath(id));
    assert.ok(fs.existsSync(p), 'missing asset ' + FRONTEND.iconPath(id));
    const png = fs.readFileSync(p);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', id + ' is a PNG');
  });
});

test('stable IDs resolve to the accepted graphics, independent of display order', () => {
  const expectedAssets = {
    'beat-performer': 'verdant-oracle.png', 'frost-mage': 'frost-mage.png', 'heavy-guardian': 'heavy-guardian.png',
    'marksman': 'twin-striker.png', 'shield-knight': 'stormblade.png', 'stormblade': 'shield-knight.png',
    'twin-striker': 'beat-performer.png', 'verdant-oracle': 'marksman.png', 'wind-knight': 'wind-knight.png'
  };
  for (const [id, asset] of Object.entries(expectedAssets)) assert.equal(FRONTEND.getClass(id).iconAsset, asset, id);
  const reordered = FRONTEND.catalogue.slice().reverse();
  for (const c of reordered) assert.equal(FRONTEND.iconPath(c.id), 'assets/classes/' + expectedAssets[c.id]);
});

test('validate accepts only builds that belong to the class', () => {
  assert.equal(FRONTEND.validate('frost-mage', 'frostbeam').ok, true);
  assert.equal(FRONTEND.validate('frost-mage', 'moonstrike').ok, false);
  assert.equal(FRONTEND.validate('nope', 'main').ok, false);
});

test('the backend Classes.gs catalogue is identical to the versioned public registry', () => {
  // Cross a vm-realm boundary via JSON so prototype identity doesn't matter.
  const back = JSON.parse(JSON.stringify(backendCatalogue()));
  assert.deepEqual(back.colours, STATIC.colours, 'colours match');
  assert.deepEqual(
    back.catalogue.map(c => ({ id: c.id, name: c.name, displayName: c.displayName, iconAsset: c.iconAsset, colour: c.colour, colourFamily: c.colourFamily, role: c.role, roleLabel: c.roleLabel, roleColor: c.roleColor, combatRole: c.combatRole, builds: c.builds.map(b => b.id + ':' + b.name) })),
    STATIC.classes.map(c => ({ id: c.id, name: c.name, displayName: c.displayName, iconAsset: c.iconAsset, colour: c.colour, colourFamily: c.colourFamily, role: c.role, roleLabel: c.roleLabel, roleColor: c.roleColor, combatRole: c.combatRole, builds: c.builds.map(b => b.id + ':' + b.name) })),
    'frontend and backend catalogues must not drift'
  );
});
