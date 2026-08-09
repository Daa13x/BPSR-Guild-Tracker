'use strict';
/** Mocked Apps Script runtime shared by the backend behavioural tests. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');

function runtime() {
  const sheets = {};
  let seq = 0;
  class Sheet {
    constructor() { this.rows = []; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows[0] ? this.rows[0].length : 0; }
    appendRow(r) { this.rows.push(r); }
    deleteRow(rowNum) { this.rows.splice(rowNum - 1, 1); }
    setFrozenRows() {}
    getRange(r, c, n = 1, m = 1) {
      const s = this;
      return {
        getValues() { return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => (s.rows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
        setValues(v) { v.forEach((row, i) => { s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; row.forEach((x, j) => s.rows[r - 1 + i][c - 1 + j] = x); }); },
        setValue(v) { s.rows[r - 1] = s.rows[r - 1] || []; s.rows[r - 1][c - 1] = v; }
      };
    }
  }
  const ss = { getSheetByName: n => sheets[n], insertSheet: n => sheets[n] = new Sheet() };

  // Configurable Script Properties (never populated with a real token in tests).
  const props = { BPSR_ADMIN_SECRET: 'secret' };

  // In-memory cache exercising the real get/put/remove logic.
  const cacheStore = {};
  const cache = { get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } };

  // ---- Mock GitHub git-data API (in-memory private data repo) ----
  const github = {
    files: {},              // path -> JSON string at HEAD
    head: 'commit-0',
    commits: { 'commit-0': { tree: 'tree-0', parents: [], files: {} } },
    pendingTrees: {},       // treeSha -> file snapshot staged by /git/trees
    seq: 0,
    conflictOnce: false,    // force one non-fast-forward on the next ref update
    fail: null,             // 'network' | 'ref500' | 'commit500' | number(code)
    requests: [],
    authHeaderSeen: []
  };
  function b64enc(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
  function ghResp(code, body) { return { getResponseCode: () => code, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) }; }
  function urlFetch(url, options) {
    options = options || {};
    const method = String(options.method || 'get').toLowerCase();
    github.requests.push({ method, url });
    if (options.headers && options.headers.Authorization) github.authHeaderSeen.push(options.headers.Authorization);
    if (github.fail === 'network') throw new Error('network unreachable');
    const body = options.payload ? JSON.parse(options.payload) : null;
    // GET contents
    let m = url.match(/\/contents\/(.+?)(?:\?ref=(.+))?$/);
    if (method === 'get' && m) {
      const p = decodeURIComponent(m[1].split('/').map(decodeURIComponent).join('/'));
      if (!(p in github.files)) return ghResp(404, { message: 'Not Found' });
      return ghResp(200, { content: b64enc(github.files[p]), sha: 'blob-' + p });
    }
    // GET ref
    if (method === 'get' && /\/git\/ref\/heads\//.test(url)) {
      if (github.fail === 'ref500') return ghResp(500, { message: 'server error' });
      return ghResp(200, { object: { sha: github.head } });
    }
    // GET commit
    if (method === 'get' && /\/git\/commits\//.test(url)) {
      const sha = url.split('/git/commits/')[1];
      const c = github.commits[sha];
      if (!c) return ghResp(404, { message: 'Not Found' });
      return ghResp(200, { tree: { sha: c.tree } });
    }
    // POST tree
    if (method === 'post' && /\/git\/trees$/.test(url)) {
      const base = github.commits[github.head] && github.commits[github.head].tree === body.base_tree
        ? Object.assign({}, github.commits[github.head].files) : {};
      (body.tree || []).forEach(it => { base[it.path] = it.content; });
      const sha = 'tree-' + (++github.seq);
      github.pendingTrees[sha] = base;
      return ghResp(201, { sha });
    }
    // POST commit
    if (method === 'post' && /\/git\/commits$/.test(url)) {
      if (github.fail === 'commit500') return ghResp(500, { message: 'server error' });
      const sha = 'commit-' + (++github.seq);
      github.commits[sha] = { tree: body.tree, parents: body.parents || [], files: github.pendingTrees[body.tree] || {} };
      return ghResp(201, { sha, tree: { sha: body.tree } });
    }
    // PATCH ref (no force)
    if (method === 'patch' && /\/git\/refs\/heads\//.test(url)) {
      (github.refUpdates = github.refUpdates || []).push(body);
      if (typeof github.fail === 'number') return ghResp(github.fail, { message: 'error' });
      if (github.conflictOnce) { github.conflictOnce = false; return ghResp(422, { message: 'Update is not a fast forward' }); }
      const newSha = body.sha, commit = github.commits[newSha];
      if (!commit || commit.parents[0] !== github.head) return ghResp(422, { message: 'Update is not a fast forward' });
      github.head = newSha;
      github.files = Object.assign({}, commit.files);   // strip the trailing newline written by the store
      Object.keys(github.files).forEach(k => { github.files[k] = String(github.files[k]); });
      return ghResp(200, { object: { sha: newSha } });
    }
    return ghResp(404, { message: 'unhandled ' + method + ' ' + url });
  }

  const ctx = {
    console, Date, JSON, Math, String, Number, Object, Array, RegExp, isFinite, Boolean,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, s) => [...crypto.createHash('sha256').update(s).digest()],
      getUuid: () => String(++seq).padStart(12, '0') + '-0000-4000-8000-' + crypto.randomBytes(6).toString('hex'),
      base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
      base64Decode: b => Buffer.from(String(b), 'base64'),
      newBlob: buf => ({ getDataAsString: () => Buffer.from(buf).toString('utf8') })
    },
    UrlFetchApp: { fetch: urlFetch },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, mimeType: null, setMimeType(m) { this.mimeType = m; return this; } }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'AuthApi.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'MasterSeal.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Classes.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'GitHubStore.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Migration.gs'), 'utf8'), ctx);
  ctx.ensureActivePeriod_ = () => ({ ResetPeriodId: 'RP1', _row: 2, FirstUpdaterUserId: '' });
  ctx.setupSpreadsheet();
  ctx.__sheets = sheets;
  ctx.__props = props;
  ctx.__github = github;
  ctx.__cache = cacheStore;
  return ctx;
}

function call(c, action, data) { return c.api_(action, data || {}); }
function sessions(c, kind, memberId) { return c.readTable_(c.AUTH_SHEETS.SESSIONS).rows.filter(r => (!kind || String(r.Kind) === kind) && (!memberId || String(r.MemberId) === String(memberId))); }
function setConfig(c, key, value) { c.__sheets.Config.appendRow([key, value]); }
/** Insert a legacy short-lived member session directly, as the old PIN system did. */
function legacySession(c, memberId, ttlMs = 3600000) {
  const token = 'legacy-' + crypto.randomBytes(24).toString('hex');
  c.__sheets.Sessions.appendRow([c.hash_(token), memberId, 'member', new Date(Date.now() + ttlMs), '', new Date(), '']);
  return token;
}

module.exports = { runtime, call, sessions, setConfig, legacySession };
