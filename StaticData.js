/* Versioned, public definitions loaded once from the same Pages origin. */
(function (root) {
  'use strict';
  var VERSION = 1, MANIFEST_VERSION = '2026-08-03-static-v2', manifestPromise = null, dataPromise = null, cached = null, handlers = [];
  var DEV = Boolean(root.location && /(?:localhost|127\.0\.0\.1)/.test(root.location.hostname));
  function diagnostic(message) { if (DEV && root.console && root.console.debug) root.console.debug('[BPSR static]', message); }
  function fail(code, message) { var error = new Error(message); error.code = code; return error; }
  function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { immutable(value[key]); });
    return Object.freeze(value);
  }
  function sameOrigin(path, dataVersion) {
    if (typeof path !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(path)) throw fail('STATIC_INVALID_PATH', 'Static data manifest contains an invalid file path.');
    return 'data/' + path + '?v=' + encodeURIComponent(dataVersion);
  }
  function fetchJson(url) {
    return root.fetch(url, { credentials: 'same-origin', cache: 'force-cache', headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw fail('STATIC_HTTP', 'Public definitions could not be loaded (' + response.status + ').');
        return response.text();
      }).then(function (text) {
        try { return JSON.parse(text); } catch (_) { throw fail('STATIC_MALFORMED', 'Public definitions are not valid JSON.'); }
      });
  }
  function validateManifest(value) {
    if (!value || value.schemaVersion !== VERSION || !value.files || typeof value.files !== 'object') throw fail('STATIC_SCHEMA', 'Unsupported public-definition manifest version.');
    ['classes', 'masterSeal'].forEach(function (key) { if (!value.files[key]) throw fail('STATIC_SCHEMA', 'The public-definition manifest is incomplete.'); });
    return value;
  }
  function unique(items, key, label) {
    var seen = {};
    items.forEach(function (item) { if (!item || typeof item[key] !== 'string' || !item[key] || seen[item[key]]) throw fail('STATIC_SCHEMA', 'Invalid or duplicate ' + label + ' ID.'); seen[item[key]] = true; });
  }
  function validateClasses(value) {
    if (!value || value.schemaVersion !== VERSION || !Array.isArray(value.classes) || !value.colours || !value.iconSource) throw fail('STATIC_SCHEMA', 'Class definitions are invalid.');
    unique(value.classes, 'id', 'class');
    value.classes.forEach(function (klass) { unique(klass.builds || [], 'id', 'build'); if (!klass.name || !klass.iconAsset || !value.colours[klass.colour]) throw fail('STATIC_SCHEMA', 'Class definitions are incomplete.'); });
    return value;
  }
  function validateSeal(value) {
    if (!value || value.schemaVersion !== VERSION || !value.id || !Number.isFinite(value.maxScore) || !Array.isArray(value.dungeons) || !Array.isArray(value.rewards)) throw fail('STATIC_SCHEMA', 'Master Seal definitions are invalid.');
    unique(value.dungeons, 'id', 'dungeon');
    if (!value.dungeons.length || !value.rewards.length) throw fail('STATIC_SCHEMA', 'Master Seal definitions are incomplete.');
    return value;
  }
  function notify(data) { handlers.slice().forEach(function (handler) { try { handler(data); } catch (error) { diagnostic(error.message); } }); }
  function load(force) {
    if (cached && !force) return Promise.resolve(cached);
    if (dataPromise && !force) return dataPromise;
    manifestPromise = force || !manifestPromise ? fetchJson('data/manifest.json?v=' + encodeURIComponent(MANIFEST_VERSION)).then(validateManifest) : manifestPromise;
    dataPromise = manifestPromise.then(function (manifest) {
      return Promise.all([fetchJson(sameOrigin(manifest.files.classes, manifest.dataVersion)).then(validateClasses), fetchJson(sameOrigin(manifest.files.masterSeal, manifest.dataVersion)).then(validateSeal)])
        .then(function (parts) {
          cached = immutable({ manifest: manifest, classes: parts[0], masterSeal: parts[1] });
          notify(cached); diagnostic('loaded ' + manifest.dataVersion); return cached;
        });
    }).catch(function (error) { dataPromise = null; manifestPromise = null; diagnostic(error.code || error.message); throw error; });
    return dataPromise;
  }
  root.BPSR_STATIC = {
    load: load,
    retry: function () { return load(true); },
    get: function () { return cached; },
    onReady: function (handler) { if (typeof handler !== 'function') return; handlers.push(handler); if (cached) handler(cached); },
    validate: function (manifest, classes, masterSeal) { return immutable({ manifest: validateManifest(manifest), classes: validateClasses(classes), masterSeal: validateSeal(masterSeal) }); }
  };
}(typeof window === 'undefined' ? globalThis : window));
