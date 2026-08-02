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
  function isLocalApi() {
    try {
      var parsed = new root.URL(apiUrl);
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch (_) {
      return false;
    }
  }
  root.BPSR_CONFIG = {
    apiUrl: apiUrl,
    timeoutMs: 15000,
    source: validExecUrl(supplied) ? 'query' : (validExecUrl(stored) ? 'storage' : (constantIsReal ? 'constant' : 'none')),
    invalidQuery: Boolean(supplied && !validExecUrl(supplied)),
    isConfigured: function () { return validExecUrl(apiUrl); },
    isLocal: isLocalApi
  };

  /* ---------------------------------------------------------------------
   * Season 3 — the published schedule, not an announced end date.
   * One source of truth for every visible Season 3 statement.
   * ------------------------------------------------------------------- */
  root.BPSR_SEASON = {
    name: 'Season 3',
    subtitle: 'Echoes of Ember',
    endDateAnnounced: false,
    scheduleThrough: '19 August 2026',
    shortNote: 'End date not announced',
    statement: 'The exact end date for Season 3, “Echoes of Ember,” has not been formally announced. ' +
      'The currently published event and reward schedule extends through 19 August 2026.'
  };

  /* ---------------------------------------------------------------------
   * Failure classification.
   * The interface must never show a bare "API error", "Unknown action",
   * "Server error" or a raw backend string. Every failure is mapped to an
   * honest state; the technical detail is logged to the console instead.
   * ------------------------------------------------------------------- */
  // Codes the backend raises deliberately for the person using the page.
  // Their messages are already written for humans, so they pass through.
  var EXPECTED_CODES = ['VALIDATION', 'DUPLICATE', 'INVALID_CREDENTIALS', 'SESSION_EXPIRED',
    'IDENTITY_MISMATCH', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMIT'];

  function classifyFailure(failure) {
    var raw = (failure && failure.message) || '';
    var code = failure && failure.code;
    var local = isLocalApi();
    if (code === 'CONFIGURATION' || !validExecUrl(apiUrl)) {
      return {
        kind: 'configuration', status: 'Not configured',
        title: 'Tracker API not configured',
        detail: 'No Apps Script /exec URL is set for this browser, so live guild data cannot be loaded.'
      };
    }
    if (code === 'UNKNOWN_ACTION' || /unknown action/i.test(raw)) {
      return {
        kind: 'not-deployed', status: 'Backend not deployed',
        title: 'Tracker backend not deployed',
        detail: 'The configured Google Apps Script deployment does not support the required tracker actions. ' +
          'Deploying the updated Apps Script version enables them.'
      };
    }
    if (failure && (failure.name === 'AbortError' || failure.name === 'TimeoutError' ||
      failure.name === 'TypeError' || code === 'NETWORK' || /failed to fetch|networkerror|timed out/i.test(raw))) {
      return local ? {
        kind: 'unreachable', status: 'Local API unavailable',
        title: 'Local API unavailable',
        detail: 'The local /exec endpoint could not be reached. Start the development server and reload.'
      } : {
        kind: 'unreachable', status: 'API unreachable',
        title: 'Tracker API unreachable',
        detail: 'The tracker could not reach the Apps Script deployment. Check the connection and reload.'
      };
    }
    if (EXPECTED_CODES.indexOf(code) !== -1) {
      return { kind: 'expected', status: 'Connected', title: raw || 'That request could not be completed.', detail: '' };
    }
    return {
      kind: 'server', status: 'Backend request failed',
      title: 'Backend request failed',
      detail: 'The backend responded but returned an unexpected server failure. Nothing was changed.'
    };
  }

  /* ---------------------------------------------------------------------
   * Shared remembered-device session token reader. AppFrontend.js owns the
   * cookie; the boards only need to read it so a signed-in request can be
   * attributed to the viewer (e.g. so a hidden member still sees their own
   * row). Returns '' when no session cookie is present.
   * ------------------------------------------------------------------- */
  root.BPSR_SESSION = {
    token: function () {
      var secure = root.location && root.location.protocol === 'https:';
      var name = (secure ? '__Secure-bpsr-member-session' : 'bpsr-member-session') + '=';
      var parts = String(root.document && root.document.cookie || '').split(';');
      for (var i = 0; i < parts.length; i++) {
        var c = parts[i].trim();
        if (c.indexOf(name) === 0) { try { return decodeURIComponent(c.slice(name.length)); } catch (_) { return ''; } }
      }
      return '';
    }
  };

  root.BPSR_ERRORS = {
    classify: function (failure, context) {
      var classified = classifyFailure(failure);
      // Technical detail stays available for debugging, out of the interface.
      if (root.console && root.console.warn) {
        root.console.warn('[BPSR] ' + (context || 'request') + ' failed (' + classified.kind + ')', failure);
      }
      return classified;
    },
    // Full sentence for inline notices: honest title plus the reason.
    describe: function (failure, context) {
      var classified = root.BPSR_ERRORS.classify(failure, context);
      return classified.detail ? classified.title + ' — ' + classified.detail : classified.title;
    }
  };
}(window));
