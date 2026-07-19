const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function client(fetch, apiUrl) {
  const store = {};
  const ctx = {
    window: null,
    fetch,
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Error,
    localStorage: {
      getItem: key => store[key] || null,
      setItem: (key, value) => { store[key] = value; },
      removeItem: key => { delete store[key]; }
    },
    document: {
      addEventListener() {},
      querySelector() { return null; },
      getElementById() { return null; },
      createElement() {
        return {
          dataset: {},
          addEventListener() {},
          appendChild() {},
          replaceChildren() {},
          setAttribute() {}
        };
      }
    },
    console
  };
  ctx.window = ctx;
  const url = apiUrl === undefined
    ? 'https://script.google.com/macros/' + 's/test-deployment/exec'
    : apiUrl;
  ctx.BPSR_CONFIG = {
    apiUrl: url,
    timeoutMs: 50,
    isConfigured: () => Boolean(url)
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('AppFrontend.js', 'utf8'), ctx);
  return ctx.BPSR_FRONTEND;
}

test('API client posts the exact action and payload to the authoritative URL', async () => {
  let sent;
  const ui = client((url, options) => {
    sent = { url, options };
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: true, data: { svFloor: 1 } })) });
  });
  assert.deepEqual(await ui.api('progress', { token: 'opaque', svFloor: 1 }), { svFloor: 1 });
  assert.equal(sent.url, 'https://script.google.com/macros/' + 's/test-deployment/exec');
  assert.deepEqual(JSON.parse(sent.options.body), {
    action: 'progress',
    data: { token: 'opaque', svFloor: 1 }
  });
});

test('API client reports unconfigured, safe backend and invalid-response failures', async () => {
  await assert.rejects(client(() => Promise.resolve(), '').api('me', {}), /not configured/);
  await assert.rejects(client(() => Promise.resolve({
    text: () => Promise.resolve(JSON.stringify({
      ok: false,
      error: { code: 'SESSION_EXPIRED', message: 'Session expired.' }
    }))
  })).api('me', {}), failure => failure.code === 'SESSION_EXPIRED');
  await assert.rejects(client(() => Promise.resolve({
    text: () => Promise.resolve('<html>')
  })).api('me', {}), /invalid response/);
});

function runConfig(search, initialStore, storageThrows, keepConstant) {
  const store = { ...(initialStore || {}) };
  const ctx = {
    window: null,
    URL,
    URLSearchParams,
    location: { search: search || '' },
    localStorage: {
      getItem: key => {
        if (storageThrows) throw new Error('denied');
        return store[key] || null;
      },
      setItem: (key, value) => {
        if (storageThrows) throw new Error('denied');
        store[key] = value;
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  let source = fs.readFileSync('config.js', 'utf8');
  if (!keepConstant) {
    // Neutralize the committed production constant so these tests exercise
    // the query/storage/none fallback tiers regardless of deployment state.
    source = source.replace(/var configuredApiUrl = '[^']*';/, "var configuredApiUrl = 'PASTE_APPS_SCRIPT_EXEC_URL_HERE';");
  }
  vm.runInContext(source, ctx);
  return { config: ctx.BPSR_CONFIG, store };
}

test('one API configuration source persists only an explicit valid Apps Script URL', () => {
  const url = 'https://script.google.com/macros/' + 's/abc_123-XYZ/exec';
  const blank = runConfig('', {});
  assert.equal(blank.config.isConfigured(), false);
  assert.equal(blank.config.source, 'none');
  assert.equal(blank.store.bpsrApiUrl, undefined);

  const supplied = runConfig('?api=' + encodeURIComponent(url), {});
  assert.equal(supplied.config.apiUrl, url);
  assert.equal(supplied.config.source, 'query');
  assert.equal(supplied.store.bpsrApiUrl, url);

  const restored = runConfig('', supplied.store);
  assert.equal(restored.config.apiUrl, url);
  assert.equal(restored.config.source, 'storage');
  assert.equal(restored.config.isConfigured(), true);
});

test('committed constant configures the production Apps Script URL and still yields to an explicit query', () => {
  const production = runConfig('', {}, false, true);
  assert.equal(production.config.source, 'constant');
  assert.equal(production.config.isConfigured(), true);
  assert.match(production.config.apiUrl, new RegExp('^https://script\\.google\\.com/macros/' + 's/[A-Za-z0-9_-]+/exec$'));

  const override = 'https://script.google.com/macros/' + 's/abc_123-XYZ/exec';
  const overridden = runConfig('?api=' + encodeURIComponent(override), {}, false, true);
  assert.equal(overridden.config.apiUrl, override);
  assert.equal(overridden.config.source, 'query');
});

test('local mock backends are accepted for development while other origins fail closed', () => {
  const local = runConfig('?api=' + encodeURIComponent('http://localhost:8788/exec'), {});
  assert.equal(local.config.isConfigured(), true);
  assert.equal(local.config.source, 'query');
  const loopback = runConfig('?api=' + encodeURIComponent('http://127.0.0.1:8788/exec'), {});
  assert.equal(loopback.config.isConfigured(), true);
  const remote = runConfig('?api=' + encodeURIComponent('https://evil.example.com/exec'), {});
  assert.equal(remote.config.isConfigured(), false);
  assert.equal(remote.config.invalidQuery, true);
});

test('invalid API values and unavailable storage fail closed without breaking the page', () => {
  const invalid = runConfig('?api=' + encodeURIComponent('https://example.com/not-apps-script'), {
    bpsrApiUrl: 'javascript:alert(1)'
  });
  assert.equal(invalid.config.apiUrl, '');
  assert.equal(invalid.config.invalidQuery, true);
  assert.equal(invalid.config.isConfigured(), false);

  const denied = runConfig(
    '?api=' + encodeURIComponent('https://script.google.com/macros/' + 's/temporary/exec'),
    {},
    true
  );
  assert.equal(denied.config.isConfigured(), true);
  assert.equal(denied.config.source, 'query');
});
