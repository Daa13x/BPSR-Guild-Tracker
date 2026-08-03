/*
 * OnlyPaws — canonical class & build catalogue.
 *
 * This is the single source of truth for the class selector, shared by the UI
 * and the tests. The backend keeps an identical copy in Classes.gs; a test
 * (tests/backend/classes-catalogue.test.js) asserts the two never drift.
 *
 * IDs are stable and lowercase; display names/colours/build order are exact.
 * "Primary/Secondary" is the entry's importance to the user and lives on the
 * saved selection, NOT here. "Main" is a build path, never a synonym for
 * "Primary".
 */
(function (root) {
  'use strict';

  // Semantic class-colour tokens. Adjusted only for contrast on the dark theme.
  var CLASS_COLOURS = {
    green: '#58D68D',
    red: '#F06A78',
    blue: '#5FA8FF'
  };

  // Ordered exactly as the selector grid must present them.
  var CLASS_CATALOGUE = [
    { id: 'beat-performer', name: 'Beat Performer', displayName: 'Beat Performer', iconAsset: 'verdant-oracle.png', colour: 'green', colourFamily: 'green', role: 'support', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'concerto', name: 'Concerto' }] },
    { id: 'frost-mage', name: 'Frost Mage', displayName: 'Frost Mage', iconAsset: 'frost-mage.png', colour: 'red', colourFamily: 'red', role: 'ranged magic', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'frostbeam', name: 'Frostbeam' }, { id: 'icicle', name: 'Icicle' }] },
    { id: 'heavy-guardian', name: 'Heavy Guardian', displayName: 'Heavy Guardian', iconAsset: 'heavy-guardian.png', colour: 'blue', colourFamily: 'blue', role: 'tank', combatRole: 'tank',
      builds: [{ id: 'main', name: 'Main' }, { id: 'block', name: 'Block' }, { id: 'earthfort', name: 'Earthfort' }] },
    { id: 'marksman', name: 'Marksman', displayName: 'Marksman', iconAsset: 'twin-striker.png', colour: 'red', colourFamily: 'red', role: 'ranged', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'falconry', name: 'Falconry' }, { id: 'wildpack', name: 'Wildpack' }] },
    { id: 'shield-knight', name: 'Shield Knight', displayName: 'Shield Knight', iconAsset: 'shield-knight.png', colour: 'blue', colourFamily: 'blue', role: 'guard', combatRole: 'tank',
      builds: [{ id: 'main', name: 'Main' }, { id: 'shield', name: 'Shield' }, { id: 'recovery', name: 'Recovery' }] },
    { id: 'stormblade', name: 'Stormblade', displayName: 'Stormblade', iconAsset: 'stormblade.png', colour: 'red', colourFamily: 'red', role: 'melee', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'moonstrike', name: 'Moonstrike' }, { id: 'slash', name: 'Slash' }] },
    { id: 'twin-striker', name: 'Twin Striker', displayName: 'Twin Striker', iconAsset: 'beat-performer.png', colour: 'red', colourFamily: 'red', role: 'melee', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'formless', name: 'Formless' }, { id: 'crimson', name: 'Crimson' }] },
    { id: 'verdant-oracle', name: 'Verdant Oracle', displayName: 'Verdant Oracle', iconAsset: 'marksman.png', colour: 'green', colourFamily: 'green', role: 'healer', combatRole: 'healer',
      builds: [{ id: 'main', name: 'Main' }, { id: 'lifebind', name: 'Lifebind' }, { id: 'smite', name: 'Smite' }] },
    { id: 'wind-knight', name: 'Wind Knight', displayName: 'Wind Knight', iconAsset: 'wind-knight.png', colour: 'red', colourFamily: 'red', role: 'lance', combatRole: 'dps',
      builds: [{ id: 'main', name: 'Main' }, { id: 'skyward', name: 'Skyward' }, { id: 'vanguard', name: 'Vanguard' }] }
  ];

  // Provisional icon mapping supplied with the spec (Profession_N.png → class),
  // copied into assets/classes/<id>.png. Kept as an explicit map so the source
  // profession numbers never leak into the rest of the code.
  var CLASS_ICON_SOURCE = {
    'beat-performer': 'Profession_13.png',
    'frost-mage': 'Profession_2.png',
    'heavy-guardian': 'Profession_9.png',
    'marksman': 'Profession_11.png',
    'shield-knight': 'Profession_1.png',
    'stormblade': 'Profession_12.png',
    'twin-striker': 'Profession_3.png',
    'verdant-oracle': 'Profession_5.png',
    'wind-knight': 'Profession_4.png'
  };

  function iconPath(classId) { var c = byId[classId]; return c ? 'assets/classes/' + c.iconAsset : ''; }

  var byId = {};
  CLASS_CATALOGUE.forEach(function (c) { byId[c.id] = c; });

  function getClass(classId) { return byId[classId] || null; }
  function colourHex(classId) { var c = byId[classId]; return c ? CLASS_COLOURS[c.colour] : null; }

  /** Validate a class/build pair. Returns { ok, error, class, build }. */
  function validate(classId, buildId) {
    var c = byId[classId];
    if (!c) return { ok: false, error: 'Unknown class.' };
    var b = null;
    c.builds.forEach(function (x) { if (x.id === buildId) b = x; });
    if (!b) return { ok: false, error: 'That build does not belong to ' + c.name + '.' };
    return { ok: true, class: c, build: b };
  }

  var api = {
    catalogue: CLASS_CATALOGUE,
    colours: CLASS_COLOURS,
    iconSource: CLASS_ICON_SOURCE,
    iconPath: iconPath,
    getClass: getClass,
    colourHex: colourHex,
    validate: validate
  };

  root.BPSR_CLASSES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window === 'undefined' ? globalThis : window));
