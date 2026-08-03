#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const forbidden = new Set(['username', 'charactername', 'membername', 'email', 'recoverycode', 'backupcode', 'password', 'passwordhash', 'session', 'token', 'secret', 'ipaddress', 'avatarurl', 'adminnote', 'userid', 'accountid', 'progress', 'score', 'completedby']);
const allow = new Set(['maxscore', 'score']);
const errors = [];
function walk(value, location) {
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, location + '[' + index + ']'));
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (forbidden.has(normalized) && !allow.has(normalized)) errors.push(location + ': forbidden static-data field ' + key);
    walk(child, location + '.' + key);
  });
}
function ids(items, label) {
  const seen = new Set();
  items.forEach(item => { if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) errors.push('invalid or duplicate ' + label + ' id'); else seen.add(item.id); });
}
const manifest = read('data/manifest.json');
const classes = read('data/classes.json');
const seal = read('data/master-seal.json');
walk(manifest, 'manifest'); walk(classes, 'classes'); walk(seal, 'masterSeal');
if (manifest.schemaVersion !== 1 || manifest.files.classes !== 'classes.json' || manifest.files.masterSeal !== 'master-seal.json') errors.push('invalid static manifest');
if (classes.schemaVersion !== 1 || !classes.colours || !classes.iconSource || !Array.isArray(classes.classes)) errors.push('invalid classes schema');
ids(classes.classes || [], 'class'); (classes.classes || []).forEach(c => ids(c.builds || [], 'build'));
if (seal.schemaVersion !== 1 || !seal.id || !Array.isArray(seal.dungeons) || !Array.isArray(seal.rewards)) errors.push('invalid Master Seal schema');
ids(seal.dungeons || [], 'dungeon');
function evaluate(relative, endMarker, result) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const ctx = { Object, Array, String, Number, JSON };
  vm.createContext(ctx); vm.runInContext(source.slice(0, source.indexOf(endMarker)) + '\nthis.result = ' + result + ';', ctx);
  return JSON.parse(JSON.stringify(ctx.result));
}
const backendClasses = evaluate('Classes.gs', 'var CLASS_BY_ID', '{ classes: CLASS_CATALOGUE, colours: CLASS_COLOURS }');
const backendSeal = evaluate('MasterSeal.gs', 'function ensureMasterSealSheet_', 'MASTER_SEAL_SEASON');
if (JSON.stringify({ classes: classes.classes, colours: classes.colours }) !== JSON.stringify(backendClasses)) errors.push('Classes.gs differs from data/classes.json');
if (JSON.stringify(seal) !== JSON.stringify(Object.assign({ schemaVersion: 1 }, backendSeal))) errors.push('MasterSeal.gs differs from data/master-seal.json');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('Static data schemas, privacy guard, and backend parity passed.');
