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
  const ctx = {
    console, Date, JSON, Math, String, Number, Object, Array, RegExp, isFinite,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, s) => [...crypto.createHash('sha256').update(s).digest()],
      getUuid: () => String(++seq).padStart(12, '0') + '-0000-4000-8000-' + crypto.randomBytes(6).toString('hex')
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get() {}, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'BPSR_ADMIN_SECRET' ? 'secret' : null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, mimeType: null, setMimeType(m) { this.mimeType = m; return this; } }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'AuthApi.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'MasterSeal.gs'), 'utf8'), ctx);
  ctx.ensureActivePeriod_ = () => ({ ResetPeriodId: 'RP1', _row: 2, FirstUpdaterUserId: '' });
  ctx.setupSpreadsheet();
  ctx.__sheets = sheets;
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
