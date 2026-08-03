/* Public class registry. Definitions are installed from data/classes.json. */
(function (root) {
  'use strict';
  var catalogue = [], colours = {}, iconSource = {}, byId = {};
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function install(data) {
    var source = data && Array.isArray(data.classes) ? data : null;
    if (!source || !Array.isArray(source.classes)) throw new Error('Class definitions are unavailable.');
    catalogue = clone(source.classes);
    colours = clone(source.colours);
    iconSource = clone(source.iconSource);
    byId = {};
    catalogue.forEach(function (klass) { byId[klass.id] = klass; });
    api.catalogue = catalogue; api.colours = colours; api.iconSource = iconSource; api.ready = true;
    return api;
  }
  function getClass(classId) { return byId[classId] || null; }
  function iconPath(classId) { var klass = getClass(classId); return klass ? 'assets/classes/' + klass.iconAsset : ''; }
  function colourHex(classId) { var klass = getClass(classId); return klass ? colours[klass.colour] || null : null; }
  function validate(classId, buildId) {
    var klass = getClass(classId);
    if (!klass) return { ok: false, error: 'Unknown class.' };
    var build = (klass.builds || []).filter(function (item) { return item.id === buildId; })[0];
    return build ? { ok: true, class: klass, build: build } : { ok: false, error: 'That build does not belong to ' + klass.name + '.' };
  }
  var api = { catalogue: catalogue, colours: colours, iconSource: iconSource, ready: false, install: install, iconPath: iconPath, getClass: getClass, colourHex: colourHex, validate: validate };
  root.BPSR_CLASSES = api;
  if (root.BPSR_STATIC) root.BPSR_STATIC.onReady(function (data) { install(data.classes); });
  if (typeof module !== 'undefined' && module.exports) {
    try { install(require('./data/classes.json')); } catch (_) { /* browser-only build has no CommonJS loader */ }
    module.exports = api;
  }
}(typeof window === 'undefined' ? globalThis : window));
