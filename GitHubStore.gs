/**
 * GitHubStore.gs — secure client for the PRIVATE data repo.
 *
 * Writes the guild's NON-PRIVATE tracker data (profiles, classes, Stim Vault,
 * Master Seal, NM/Easy-Hard raid, scores, board, reset periods) to
 * `state/…` in the private data repository via the GitHub git-data API.
 *
 * Security invariants (do not weaken):
 *  - The token is read ONLY from Script Properties at request time. It is
 *    never returned, logged, cached, put in an error message, or sent to the
 *    browser. `safeStatus_()` deliberately omits it.
 *  - Writes are restricted to `state/` under the configured prefix; any other
 *    path is rejected. The browser never chooses a path.
 *  - Every written object is scanned; known private keys are rejected so a
 *    secret can never reach GitHub.
 *  - Branch updates use force:false, so a newer commit is never clobbered;
 *    conflicts are detected and retried a few times, then surfaced honestly.
 */

var GH_STATE_ROOT = 'state/';
var GH_MAX_CONFLICT_RETRIES = 4;
var GH_CACHE_PREFIX = 'ghstate_';

/** Private keys that must never appear in any GitHub-stored object. */
var GH_FORBIDDEN_KEYS = [
  'backupcode', 'backup_code', 'pinhash', 'pinsalt', 'sessiontoken', 'token',
  'tokenhash', 'sessionhash', 'secret', 'password', 'passwd', 'recovery',
  'recoverycode', 'loginattempt', 'privatememberid', 'memberid', 'email',
  'adminsecret', 'githubtoken', 'apikey', 'credential', 'salt', 'hash',
  'oauth', 'privatekey', 'signingkey', 'encryptionkey'
];

function ghProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    token: p.getProperty('GITHUB_DATA_TOKEN') || '',
    owner: p.getProperty('GITHUB_DATA_OWNER') || '',
    repo: p.getProperty('GITHUB_DATA_REPO') || '',
    branch: p.getProperty('GITHUB_DATA_BRANCH') || 'main',
    prefix: ghNormalisePrefix_(p.getProperty('GITHUB_DATA_PREFIX') || ''),
    mode: String(p.getProperty('GITHUB_DATA_MODE') || 'sheets')
  };
}

function ghNormalisePrefix_(raw) {
  var s = String(raw || '').replace(/^\/+|\/+$/g, '');
  if (s && !/^[A-Za-z0-9._\/\-]+$/.test(s)) throw apiError_('CONFIG', 'GITHUB_DATA_PREFIX contains invalid characters.');
  return s;
}

/** Configured only when a token, owner and repo are present. */
function githubConfigured_() { var c = ghProps_(); return Boolean(c.token && c.owner && c.repo); }

/** The active storage mode, clamped to a known value. */
function storageMode_() { var m = ghProps_().mode; return (m === 'github' || m === 'shadow') ? m : 'sheets'; }

/** Full repo path for a `state/…` relative path, rejecting traversal/escape. */
function ghStatePath_(rel) {
  if (typeof rel !== 'string' || !rel) throw apiError_('BAD_PATH', 'A data path is required.');
  if (rel.indexOf('..') !== -1 || rel.indexOf('//') !== -1 || rel.charAt(0) === '/') {
    throw apiError_('BAD_PATH', 'Invalid data path.');
  }
  if (!/^[A-Za-z0-9._\/\-]+$/.test(rel)) throw apiError_('BAD_PATH', 'Invalid data path.');
  if (rel.indexOf(GH_STATE_ROOT) !== 0) throw apiError_('BAD_PATH', 'Data may only be written under state/.');
  var c = ghProps_();
  return (c.prefix ? c.prefix + '/' : '') + rel;
}

/** Deep-scan an object for forbidden private keys. Throws if any are present. */
function ghAssertNoPrivate_(value, path) {
  path = path || 'root';
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(function (v, i) { ghAssertNoPrivate_(v, path + '[' + i + ']'); }); return; }
  Object.keys(value).forEach(function (k) {
    var norm = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var i = 0; i < GH_FORBIDDEN_KEYS.length; i++) {
      var bad = GH_FORBIDDEN_KEYS[i].replace(/[^a-z0-9]/g, '');
      // publicMemberId is explicitly allowed even though it contains "memberid".
      if (k === 'publicMemberId') continue;
      if (norm === bad || (bad.length >= 5 && norm.indexOf(bad) !== -1)) {
        throw apiError_('PRIVATE_FIELD', 'A private field ("' + k + '") may not be stored in GitHub.');
      }
    }
    ghAssertNoPrivate_(value[k], path + '.' + k);
  });
}

function ghHeaders_() {
  var c = ghProps_();
  return {
    Authorization: 'Bearer ' + c.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OnlyPaws-Tracker'
  };
}
function ghApiUrl_(suffix) { var c = ghProps_(); return 'https://api.github.com/repos/' + c.owner + '/' + c.repo + suffix; }

/** Low-level request. Never surfaces the token; sanitises GitHub messages. */
function ghRequest_(method, url, payload) {
  if (!githubConfigured_()) throw apiError_('CONFIG', 'GitHub data storage is not configured.');
  var options = { method: method, muteHttpExceptions: true, headers: ghHeaders_(), contentType: 'application/json' };
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var body; try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
  return { code: code, body: body };
}

function ghExpectOk_(r, whatFailed) {
  if (r.code >= 200 && r.code < 300) return r.body;
  var msg = r.body && r.body.message ? ' ' + String(r.body.message) : '';
  throw apiError_('GITHUB', (whatFailed || 'GitHub request') + ' failed (' + r.code + ').' + msg);
}

/** Read a JSON file from state/. Returns { exists, json, sha }. */
function ghReadJson_(rel) {
  var path = ghStatePath_(rel), c = ghProps_();
  var r = ghRequest_('get', ghApiUrl_('/contents/' + ghEncodePath_(path) + '?ref=' + encodeURIComponent(c.branch)));
  if (r.code === 404) return { exists: false, json: null, sha: null };
  var body = ghExpectOk_(r, 'GitHub read');
  var content = Utilities.newBlob(Utilities.base64Decode(String(body.content || '').replace(/\s/g, ''))).getDataAsString();
  var json;
  try { json = JSON.parse(content); } catch (_) { throw apiError_('GITHUB', 'Stored JSON at ' + rel + ' is invalid.'); }
  return { exists: true, json: json, sha: body.sha };
}

function ghEncodePath_(path) { return path.split('/').map(encodeURIComponent).join('/'); }

/**
 * Atomically commit one or more JSON files under state/ in a single commit,
 * never force-updating the branch. Retries on a non-fast-forward conflict.
 * `files` is [{ rel, json }]. Returns { commit, tree }.
 */
function ghCommitFiles_(files, message) {
  if (!files || !files.length) throw apiError_('GITHUB', 'No files to commit.');
  var c = ghProps_();
  // Validate paths + reject private fields BEFORE touching GitHub.
  var items = files.map(function (f) {
    var full = ghStatePath_(f.rel);
    ghAssertNoPrivate_(f.json, f.rel);
    return { path: full, mode: '100644', type: 'blob', content: JSON.stringify(f.json, null, 2) + '\n' };
  });

  var attempt = 0, lastConflict = null;
  while (attempt < GH_MAX_CONFLICT_RETRIES) {
    attempt++;
    var ref = ghExpectOk_(ghRequest_('get', ghApiUrl_('/git/ref/heads/' + encodeURIComponent(c.branch))), 'GitHub ref read');
    var baseSha = ref.object.sha;
    var baseCommit = ghExpectOk_(ghRequest_('get', ghApiUrl_('/git/commits/' + baseSha)), 'GitHub base commit');
    var tree = ghExpectOk_(ghRequest_('post', ghApiUrl_('/git/trees'), { base_tree: baseCommit.tree.sha, tree: items }), 'GitHub tree create');
    var commit = ghExpectOk_(ghRequest_('post', ghApiUrl_('/git/commits'),
      { message: message || 'Update tracker state', tree: tree.sha, parents: [baseSha] }), 'GitHub commit create');
    // Update the branch WITHOUT force — a newer head makes this fail, not clobber.
    var upd = ghRequest_('patch', ghApiUrl_('/git/refs/heads/' + encodeURIComponent(c.branch)), { sha: commit.sha, force: false });
    if (upd.code >= 200 && upd.code < 300) {
      ghBustCache_();
      return { commit: commit.sha, tree: tree.sha, attempts: attempt };
    }
    // 422 = not a fast-forward → someone committed after our read. Retry.
    if (upd.code === 422) { lastConflict = upd; continue; }
    ghExpectOk_(upd, 'GitHub ref update');
  }
  throw apiError_('GITHUB_CONFLICT', 'GitHub had newer changes after ' + GH_MAX_CONFLICT_RETRIES + ' attempts; the write was NOT applied. Please retry.');
}

/** Current branch head commit SHA, or null when the branch/ref is unset. */
function ghBranchHead_() {
  var c = ghProps_();
  var r = ghRequest_('get', ghApiUrl_('/git/ref/heads/' + encodeURIComponent(c.branch)));
  if (r.code === 404) return null;
  var body = ghExpectOk_(r, 'GitHub ref read');
  return body.object ? body.object.sha : null;
}

/**
 * Editor-only connectivity check. Run this once after setting the Script
 * Properties to authorise UrlFetchApp and prove this deployment can reach the
 * configured private repository. It returns a branch SHA only; credentials
 * and response bodies are never logged or returned.
 */
function testGithubConnection() {
  return { connected: true, branchHead: ghBranchHead_() };
}

// --- small cache for hot public reads (board / member), cleared after writes ---
function ghCache_() { try { return CacheService.getScriptCache(); } catch (_) { return null; } }
function ghCacheGet_(key) { var c = ghCache_(); if (!c) return null; var v = c.get(GH_CACHE_PREFIX + key); if (!v) return null; try { return JSON.parse(v); } catch (_) { return null; } }
function ghCachePut_(key, value, ttl) { var c = ghCache_(); if (!c) return; try { c.put(GH_CACHE_PREFIX + key, JSON.stringify(value), ttl || 60); } catch (_) { /* too large: skip */ } }
function ghBustCache_() { var c = ghCache_(); if (!c) return; try { c.remove(GH_CACHE_PREFIX + 'board'); c.remove(GH_CACHE_PREFIX + 'manifest'); } catch (_) { /* best effort */ } }

/** Non-secret status for the admin screen. NEVER includes the token. */
function ghSafeStatus_() {
  var c = ghProps_();
  return {
    configured: githubConfigured_(),
    mode: storageMode_(),
    owner: c.owner,
    repo: c.repo,
    branch: c.branch,
    prefix: c.prefix,
    hasToken: Boolean(c.token)   // boolean only — never the value
  };
}
