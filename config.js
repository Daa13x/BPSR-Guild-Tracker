/*
 * OnlyPaws API configuration.
 * Replace the placeholder below with the deployed Apps Script /exec URL.
 * A one-time ?api=https://.../exec query may also be used; only an explicitly
 * supplied query value is persisted in this browser.
 */
(function (root) {
  'use strict';
  var configuredApiUrl = 'https://script.google.com/macros/s/AKfycbyImSiO-iSXsL1KoFXWNv98Hen3ak6k-T3HB_F15Gv3t3kNQoa2WStLPGlMImHwda2Vlg/exec';
  var storageKey = 'bpsrApiUrl';
  function validExecUrl(value) {
    try {
      var parsed = new root.URL(String(value || ''));
      if (parsed.protocol === 'https:' && parsed.hostname === 'script.google.com' &&
        /^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(parsed.pathname)) return true;
      // Local mock backend for development and smoke tests only.
      return (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        /^\/exec\/?$/.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  }
  function readStored() {
    try { return String(root.localStorage.getItem(storageKey) || '').trim(); }
    catch (_) { return ''; }
  }
  function storeExplicit(value) {
    try { root.localStorage.setItem(storageKey, value); }
    catch (_) { /* Configuration still works for this page load. */ }
  }
  var params = new URLSearchParams(root.location ? root.location.search : '');
  var supplied = String(params.get('api') || '').trim();
  if (validExecUrl(supplied)) storeExplicit(supplied);
  var stored = readStored();
  var constantIsReal = configuredApiUrl.indexOf('PASTE_') < 0 && validExecUrl(configuredApiUrl);
  // An explicitly supplied override (persisted from ?api=) outranks the
  // committed constant on every later visit; clear bpsrApiUrl to return.
  var apiUrl = validExecUrl(supplied) ? supplied :
    (validExecUrl(stored) ? stored : (constantIsReal ? configuredApiUrl : ''));
  root.BPSR_CONFIG = {
    apiUrl: apiUrl,
    timeoutMs: 15000,
    source: validExecUrl(supplied) ? 'query' : (validExecUrl(stored) ? 'storage' : (constantIsReal ? 'constant' : 'none')),
    invalidQuery: Boolean(supplied && !validExecUrl(supplied)),
    isConfigured: function () { return validExecUrl(apiUrl); }
  };
}(window));
