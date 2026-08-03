'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..', '..');
const json = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));

function loader(responses) {
  const calls = [];
  const ctx = { console, Promise, Object, JSON, Number, Array, String, RegExp, location: { hostname: 'localhost' }, fetch(url) {
    calls.push(url); const response = responses[url];
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({ ok: response !== undefined, status: response === undefined ? 404 : 200, text: () => Promise.resolve(typeof response === 'string' ? response : JSON.stringify(response)) });
  } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'StaticData.js'), 'utf8'), ctx);
  return { api: ctx.BPSR_STATIC, calls };
}
const version = json('manifest.json').dataVersion;
const valid = { ['data/manifest.json?v=' + version]: json('manifest.json'), ['data/classes.json?v=' + version]: json('classes.json'), ['data/master-seal.json?v=' + version]: json('master-seal.json') };

test('static definitions load from same-origin files once and are immutable', async () => {
  const run = loader(valid); const [a, b] = await Promise.all([run.api.load(), run.api.load()]);
  assert.equal(a, b); assert.deepEqual(run.calls.sort(), ['data/classes.json?v=' + version, 'data/manifest.json?v=' + version, 'data/master-seal.json?v=' + version]);
  assert.equal(Object.isFrozen(a.classes), true); assert.equal(a.classes.classes.length, 9);
});
test('malformed data and unsupported schema fail honestly and allow retry', async () => {
  const responses = { ...valid, ['data/classes.json?v=' + version]: '{' }; const run = loader(responses);
  await assert.rejects(run.api.load(), { code: 'STATIC_MALFORMED' });
  responses['data/classes.json?v=' + version] = valid['data/classes.json?v=' + version];
  assert.equal((await run.api.retry()).masterSeal.id, 'season-3');
  const invalid = loader({ ...valid, ['data/manifest.json?v=' + version]: { ...valid['data/manifest.json?v=' + version], schemaVersion: 2 } });
  await assert.rejects(invalid.api.load(), { code: 'STATIC_SCHEMA' });
});
