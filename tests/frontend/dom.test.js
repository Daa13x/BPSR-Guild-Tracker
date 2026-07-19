const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class ClassList {
  constructor(node) { this.node = node; }
  values() { return this.node.className.split(/\s+/).filter(Boolean); }
  contains(value) { return this.values().includes(value); }
  add(value) {
    if (!this.contains(value)) this.node.className = [...this.values(), value].join(' ');
  }
  remove(value) { this.node.className = this.values().filter(item => item !== value).join(' '); }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.checked = false;
    this.tabIndex = 0;
    this._text = '';
    this.classList = new ClassList(this);
  }
  set textContent(value) {
    this._text = String(value == null ? '' : value);
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...children) {
    this._text = '';
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }
  setAttribute(name, value) {
    const string = String(value);
    this.attributes[name] = string;
    if (name === 'id') this.id = string;
    if (name === 'class') this.className = string;
    if (name === 'tabindex') this.tabIndex = Number(string);
    if (name.startsWith('data-')) this.dataset[toCamel(name.slice(5))] = string;
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'name') return this.name || null;
    if (name === 'type') return this.type || null;
    if (name.startsWith('data-')) return this.dataset[toCamel(name.slice(5))] ?? null;
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, properties) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...(properties || {})
    };
    for (const listener of this.listeners[type] || []) listener.call(this, event);
    return event;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return selectAll(this, selector); }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function descendants(root) {
  const output = [];
  for (const child of root.children || []) {
    output.push(child, ...descendants(child));
  }
  return output;
}
function matches(node, selector) {
  let remaining = selector.trim();
  const tag = remaining.match(/^[A-Za-z][A-Za-z0-9-]*/);
  if (tag) {
    if (node.tagName !== tag[0].toUpperCase()) return false;
    remaining = remaining.slice(tag[0].length);
  }
  const id = remaining.match(/#([A-Za-z0-9_-]+)/);
  if (id && node.id !== id[1]) return false;
  const classes = [...remaining.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(match => match[1]);
  if (classes.some(value => !node.classList.contains(value))) return false;
  for (const match of remaining.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
    const actual = node.getAttribute(match[1]);
    if (actual == null || (match[2] !== undefined && actual !== match[2])) return false;
  }
  return Boolean(tag || id || classes.length || remaining.includes('['));
}
function selectAll(root, selector) {
  const tokens = selector.trim().split(/\s+/);
  return descendants(root).filter(node => {
    if (!matches(node, tokens[tokens.length - 1])) return false;
    let ancestor = node.parentNode;
    for (let index = tokens.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matches(ancestor, tokens[index])) ancestor = ancestor.parentNode;
      if (!ancestor) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  });
}

class Document {
  constructor() {
    this.body = new Element('body');
    this.listeners = {};
    this.documentElement = new Element('html');
    this._cookies = {};
  }
  get cookie() {
    return Object.entries(this._cookies).map(([name, value]) => name + '=' + value).join('; ');
  }
  set cookie(text) {
    const [pair, ...attributes] = String(text).split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const maxAge = attributes.map(a => a.trim().toLowerCase()).find(a => a.startsWith('max-age='));
    if (maxAge && Number(maxAge.split('=')[1]) <= 0) delete this._cookies[name];
    else this._cookies[name] = value;
  }
  createElement(tag) { return new Element(tag); }
  getElementById(id) { return descendants(this.body).find(node => node.id === id) || null; }
  querySelector(selector) {
    if (matches(this.body, selector)) return this.body;
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) { return selectAll(this.body, selector); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  fire(type) { for (const listener of this.listeners[type] || []) listener(); }
}

class ApiFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const COOKIE = '__Secure-bpsr-member-session';
const CODE = 'BPSR-K7MD-4QPX-9VTC';

function future() { return new Date(Date.now() + 60 * 60 * 1000).toISOString(); }
function farFuture() { return new Date(Date.now() + 170 * 24 * 60 * 60 * 1000).toISOString(); }
function session(token) { return { token, expiresAt: farFuture() }; }
function profile(overrides) {
  return {
    memberId: 'MEM-1',
    characterName: 'Dax',
    svFloor: 12,
    masterPoints: 480,
    masterRanks: { ACT1: 2 },
    isAdmin: false,
    disabled: false,
    backupCodeSet: true,
    backupCodeCreatedAt: '2026-07-19T00:00:00.000Z',
    backupCodeUpdatedAt: '2026-07-19T00:00:00.000Z',
    lastAccessAt: '2026-07-19T00:00:00.000Z',
    activeSessions: 1,
    ...(overrides || {})
  };
}
function seasonFixture() {
  return {
    id: 'season-3', displayName: 'Season 3', maxScore: 3650, maxMasterLevel: 20,
    dungeons: [
      { id: 'towering-ruin', number: 1, name: 'Void - Towering Ruin', shortName: 'Towering Ruin' },
      { id: 'tinas-mindrealm', number: 2, name: "Void - Tina's Mindrealm", shortName: "Tina's Mindrealm" },
      { id: 'cursed-radiant-tomb', number: 3, name: 'Cursed Radiant Tomb', shortName: 'Radiant Tomb' },
      { id: 'mech-facility', number: 4, name: 'Mech Facility', shortName: 'Mech Facility' },
      { id: 'mistveil-hunting-ground', number: 5, name: 'Mistveil Hunting Ground', shortName: 'Mistveil' },
      { id: 'sea-ringed-reef', number: 6, name: 'Sea-Ringed Reef', shortName: 'Sea-Ringed Reef' }
    ],
    rewards: [{ score: 3650, rewardName: 'Mount: Neon Sonic', rewardType: 'mount' }]
  };
}
function emptySeal() {
  const season = seasonFixture();
  return {
    season,
    dungeons: season.dungeons.map(d => ({ dungeonId: d.id, bestMasterLevel: null, points: 0, cleared: false, updatedAt: null })),
    totals: { totalScore: 0, remainingScore: 3650, progressPercent: 0, clearedCount: 0, mountUnlocked: false, lastUpdated: null }
  };
}

function createHarness(handler, options) {
  const opts = options || {};
  const document = new Document();
  Object.assign(document._cookies, opts.cookies || {});
  function base(tag, id, parent) {
    const node = new Element(tag);
    node.id = id;
    (parent || document.body).appendChild(node);
    return node;
  }
  const member = base('div', 'member-ui');
  const administration = base('section', 'administration');
  administration.hidden = true;
  const admin = base('div', 'admin-ui', administration);
  const nav = new Element('a');
  nav.setAttribute('data-admin-nav', '');
  nav.hidden = true;
  document.body.appendChild(nav);
  const preview = base('p', 'preview-notice');
  preview.hidden = true;
  const gate = base('div', 'gate');
  gate.hidden = true;
  base('div', 'firsts');
  base('p', 'stamp');

  const store = { ...(opts.store || {}) };
  const calls = [];
  const defaultHandler = (action) => {
    if (action === 'activities') return [{ id: 'ACT1', name: 'Trial', maxRank: 20 }];
    if (action === 'myMasterSeal') return emptySeal();
    if (action === 'adminMembers' || action === 'adminDuplicates' || action === 'adminAudit') return [];
    if (action === 'logout') return { ok: true };
    return {};
  };
  const fetch = (url, request) => {
    const envelope = JSON.parse(request.body);
    calls.push({ url, action: envelope.action, data: envelope.data });
    let result;
    try {
      result = (handler || defaultHandler)(envelope.action, envelope.data, calls);
      if (result === undefined) result = defaultHandler(envelope.action);
    } catch (failure) { result = Promise.reject(failure); }
    return Promise.resolve(result).then(data => ({
      text: () => Promise.resolve(JSON.stringify({ ok: true, data }))
    }), failure => {
      if (failure instanceof ApiFailure) {
        return {
          text: () => Promise.resolve(JSON.stringify({
            ok: false,
            error: { code: failure.code, message: failure.message }
          }))
        };
      }
      return Promise.reject(failure);
    });
  };
  const ctx = {
    window: null,
    document,
    location: { protocol: 'https:', pathname: '/BPSR-Guild-Tracker/' },
    navigator: {},
    localStorage: {
      getItem: key => store[key] || null,
      setItem: (key, value) => { store[key] = value; },
      removeItem: key => { delete store[key]; }
    },
    fetch,
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Error,
    Date,
    Number,
    Boolean,
    String,
    Math,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    confirm: opts.confirm || (() => true),
    console,
    BPSR_CONFIG: {
      apiUrl: opts.configured === false ? '' : 'https://script.google.com/macros/' + 's/test/exec',
      timeoutMs: 500,
      isConfigured: () => opts.configured !== false
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('AppFrontend.js', 'utf8'), ctx);
  return {
    ctx,
    document,
    member,
    admin,
    administration,
    preview,
    gate,
    calls,
    store,
    cookies: document._cookies,
    ui: ctx.BPSR_FRONTEND,
    ready: async () => { document.fire('DOMContentLoaded'); await settle(); },
    settle
  };
}

async function settle(rounds = 10) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
function formByButton(root, label) {
  return root.querySelectorAll('form').find(form =>
    form.querySelectorAll('button').some(button => button.textContent === label)
  );
}
function buttonByText(root, label) {
  return root.querySelectorAll('button').find(button => button.textContent === label);
}
async function signIn(app, name) {
  const restoreForm = formByButton(app.gate, 'Restore access');
  restoreForm.querySelector('input[name="characterName"]').value = name || 'Dax';
  restoreForm.querySelector('input[name="backupCode"]').value = CODE;
  restoreForm.dispatch('submit');
  await settle(14);
}

test('preview notice reflects the real unified configuration state', async () => {
  const preview = createHarness(null, { configured: false });
  await preview.ready();
  assert.equal(preview.preview.hidden, false);
  assert.equal(preview.gate.hidden, true, 'no gate without a configured API');

  const connected = createHarness();
  await connected.ready();
  assert.equal(connected.preview.hidden, true);
});

test('a fresh browser shows Who are you? with both paths visible and no PIN anywhere', async () => {
  const app = createHarness();
  await app.ready();
  assert.equal(app.gate.hidden, false);
  assert.ok(buttonByText(app.gate, 'New user'));
  assert.ok(buttonByText(app.gate, 'Returning user'));
  assert.ok(formByButton(app.gate, 'Create my account'));
  const restore = formByButton(app.gate, 'Restore access');
  assert.ok(restore.querySelector('input[name="backupCode"]'));
  assert.match(app.gate.textContent, /Lost your backup code\? Contact Dax or another guild administrator\./);
  assert.equal(app.document.querySelectorAll('input[name="pin"]').length, 0);
  assert.equal(/PIN/.test(app.document.body.textContent), false);
});

test('creating an account stores only the opaque token in the cookie and presents the backup code', async () => {
  const app = createHarness((action, data) => {
    if (action === 'createAccount') {
      return { member: profile({ characterName: data.characterName }), session: session('opaque-token-1'), backupCode: CODE };
    }
  });
  await app.ready();
  const form = formByButton(app.gate, 'Create my account');
  form.querySelector('input[name="characterName"]').value = 'New Guildie';
  form.dispatch('submit');
  await settle(14);
  assert.deepEqual(app.calls.find(call => call.action === 'createAccount').data, { characterName: 'New Guildie' });
  assert.equal(app.gate.hidden, true);
  assert.equal(decodeURIComponent(app.cookies[COOKIE]), 'opaque-token-1');
  const jar = JSON.stringify(app.cookies);
  ['New Guildie', 'MEM-1', CODE, 'isAdmin'].forEach(secret =>
    assert.equal(jar.includes(secret), false, 'cookie must hold only the opaque token'));
  assert.match(app.member.textContent, /Please save this somewhere/);
  assert.match(app.member.textContent, new RegExp(CODE));
  buttonByText(app.member, 'I have saved it').click();
  await settle();
  assert.match(app.member.textContent, /Backup access/);
  assert.match(app.member.textContent, /••••-••••-••••/);
});

test('duplicate character names are not recreated and route to the returning flow', async () => {
  const app = createHarness((action) => {
    if (action === 'createAccount') throw new ApiFailure('DUPLICATE', 'That character name already has an account. Use Returning user with its backup code.');
  });
  await app.ready();
  const form = formByButton(app.gate, 'Create my account');
  form.querySelector('input[name="characterName"]').value = 'Dax';
  form.dispatch('submit');
  await settle();
  assert.match(app.gate.textContent, /already has an account/);
  assert.equal(buttonByText(app.gate, 'Returning user').getAttribute('aria-selected'), 'true');
  assert.equal(formByButton(app.gate, 'Restore access').querySelector('input[name="characterName"]').value, 'Dax');
});

test('returning users restore with name and code; failures stay generic', async () => {
  const app = createHarness((action, data) => {
    if (action === 'restore') {
      if (data.backupCode !== CODE) throw new ApiFailure('INVALID_CREDENTIALS', 'Character name or backup code is incorrect.');
      return { member: profile(), session: session('restored-token') };
    }
  });
  await app.ready();
  const form = formByButton(app.gate, 'Restore access');
  form.querySelector('input[name="characterName"]').value = 'Dax';
  form.querySelector('input[name="backupCode"]').value = 'BPSR-WRNG-WRNG-WRNG';
  form.dispatch('submit');
  await settle();
  assert.match(app.gate.textContent, /Character name or backup code is incorrect/);
  assert.equal(app.cookies[COOKIE], undefined);
  form.querySelector('input[name="backupCode"]').value = CODE;
  form.dispatch('submit');
  await settle(14);
  assert.equal(decodeURIComponent(app.cookies[COOKIE]), 'restored-token');
  assert.equal(app.gate.hidden, true);
  assert.match(app.member.textContent, /Signed in as Dax on this remembered device/);
  assert.equal(/Please save this somewhere/.test(app.member.textContent), false, 'restore does not reshow the code');
});

test('a remembered cookie restores the account silently; an expired one reopens the gate', async () => {
  const app = createHarness((action, data) => {
    if (action === 'refresh' && data.kind === 'member') {
      assert.equal(data.token, 'remembered-token');
      return { profile: profile(), expiresAt: farFuture() };
    }
  }, { cookies: { [COOKIE]: 'remembered-token' } });
  await app.ready();
  assert.equal(app.gate.hidden, true);
  assert.match(app.member.textContent, /Signed in as Dax/);

  const expired = createHarness((action, data) => {
    if (action === 'refresh') throw new ApiFailure('SESSION_EXPIRED', 'Session expired.');
  }, { cookies: { [COOKIE]: 'dead-token' } });
  await expired.ready();
  assert.equal(expired.cookies[COOKIE], undefined, 'dead cookie is cleared');
  assert.equal(expired.gate.hidden, false);
});

test('a transient failure during migration keeps the legacy session for a later retry', async () => {
  const app = createHarness((action) => {
    if (action === 'migrate') throw new Error('network unreachable');
  }, { store: {
    'bpsr.member.session': JSON.stringify({ token: 'legacy-token', expiresAt: future(), kind: 'member', display: 'Dax' })
  } });
  await app.ready();
  assert.ok(app.calls.some(call => call.action === 'migrate'));
  assert.ok(app.store['bpsr.member.session'], 'a network failure must not destroy the only migration credential');
  assert.equal(app.gate.hidden, true, 'no gate: creating a new account here would strand the legacy identity');
  assert.match(app.member.querySelector('.notice').textContent, /could not reach|try again/i);
});

test('a transient failure while restoring the cookie session keeps the cookie for a later retry', async () => {
  const app = createHarness((action) => {
    if (action === 'refresh') throw new Error('network unreachable');
  }, { cookies: { [COOKIE]: 'still-valid-token' } });
  await app.ready();
  assert.equal(app.cookies[COOKIE], 'still-valid-token', 'a network failure must not clear a possibly valid cookie');
  assert.equal(app.gate.hidden, true);
  assert.match(app.member.querySelector('.notice').textContent, /could not reach|try again/i);

  const dead = createHarness((action) => {
    if (action === 'refresh') throw new ApiFailure('SESSION_EXPIRED', 'Session expired.');
  }, { cookies: { [COOKIE]: 'definitely-dead-token' } });
  await dead.ready();
  assert.equal(dead.cookies[COOKIE], undefined, 'a definitive server rejection still clears the cookie');
  assert.equal(dead.gate.hidden, false);
});

test('a valid legacy local-storage session migrates once to the cookie and shows the code', async () => {
  const app = createHarness((action, data) => {
    if (action === 'migrate') {
      assert.equal(data.token, 'legacy-token');
      return { member: profile(), session: session('migrated-token'), backupCode: CODE };
    }
  }, { store: {
    'bpsr.member.session': JSON.stringify({ token: 'legacy-token', expiresAt: future(), kind: 'member', display: 'Dax' }),
    'bpsr.admin.session': JSON.stringify({ token: 'legacy-admin', expiresAt: future(), kind: 'admin' })
  } });
  await app.ready();
  assert.ok(app.calls.some(call => call.action === 'migrate'));
  assert.equal(decodeURIComponent(app.cookies[COOKIE]), 'migrated-token');
  assert.equal(app.store['bpsr.member.session'], undefined, 'legacy session removed after migration');
  assert.equal(app.store['bpsr.admin.session'], undefined, 'legacy admin session removed');
  assert.match(app.member.textContent, /Please save this somewhere/);
  assert.match(app.member.textContent, new RegExp(CODE));
  assert.equal(app.gate.hidden, true);
});

test('progression sends SV and ranks from the remembered session without browser totals', async () => {
  let resolveProgress;
  const progressPending = new Promise(resolve => { resolveProgress = resolve; });
  const app = createHarness((action, data) => {
    if (action === 'restore') return { member: profile(), session: session('member-token') };
    if (action === 'progress') return progressPending;
  });
  await app.ready();
  await signIn(app);
  assert.match(app.member.textContent, /SV floor12/);
  assert.match(app.member.textContent, /Master points480/);
  const form = formByButton(app.member, 'Save progression');
  form.querySelector('input[name="svFloor"]').value = '15';
  form.querySelector('input[data-activity]').value = '4';
  form.dispatch('submit');
  form.dispatch('submit');
  await settle(2);
  const progressCalls = app.calls.filter(call => call.action === 'progress');
  assert.equal(progressCalls.length, 1, 'disabled submit prevents repeated requests');
  assert.equal(progressCalls[0].data.token, 'member-token');
  assert.deepEqual(progressCalls[0].data.masterRanks, { ACT1: '4' });
  assert.equal(progressCalls[0].data.svFloor, '15');
  assert.equal('masterPoints' in progressCalls[0].data, false);
  resolveProgress({ changed: true, profile: profile({ svFloor: 15 }) });
  await settle();
  assert.match(app.member.querySelector('.notice').textContent, /Progress updated/);
});

test('the Master Seal form submits six validated dungeons and uncleared ones stay zeroed', async () => {
  const seal = emptySeal();
  const app = createHarness((action, data) => {
    if (action === 'restore') return { member: profile(), session: session('member-token') };
    if (action === 'myMasterSeal') return seal;
    if (action === 'masterSealUpdate') {
      return { changed: true, dungeons: seal.dungeons, totals: { ...seal.totals, totalScore: 316 } };
    }
  });
  await app.ready();
  await signIn(app);
  const form = formByButton(app.member, 'Save Master Seal progress');
  assert.ok(form, 'seal form renders');
  const first = form.querySelector('fieldset[data-dungeon="towering-ruin"]');
  first.querySelector('input[type="checkbox"]').checked = true;
  first.querySelector('input[type="checkbox"]').dispatch('change');
  first.querySelector('select').value = '5';
  first.querySelector('input[type="number"]').value = '316';
  form.dispatch('submit');
  await settle();
  const update = app.calls.find(call => call.action === 'masterSealUpdate');
  assert.equal(update.data.token, 'member-token');
  assert.equal(Object.keys(update.data.dungeons).length, 6);
  assert.deepEqual(update.data.dungeons['towering-ruin'], { cleared: true, bestMasterLevel: 5, points: 316 });
  assert.deepEqual(update.data.dungeons['sea-ringed-reef'], { cleared: false, bestMasterLevel: null, points: 0 });
  assert.match(app.member.querySelector('.notice').textContent, /Master Seal progress saved/);
});

test('sign out clears only this device; revoke-all requires confirmation and returns to the gate', async () => {
  const app = createHarness((action) => {
    if (action === 'restore') return { member: profile(), session: session('device-token') };
    if (action === 'logout' || action === 'revokeAllDevices') return { ok: true };
  });
  await app.ready();
  await signIn(app);
  buttonByText(app.member, 'Sign out of this device').click();
  await settle();
  assert.equal(app.calls.filter(call => call.action === 'logout').length, 1);
  assert.equal(app.cookies[COOKIE], undefined);
  assert.equal(app.gate.hidden, false, 'gate returns after sign-out');

  const revoke = createHarness((action) => {
    if (action === 'restore') return { member: profile(), session: session('device-token') };
    if (action === 'revokeAllDevices') return { ok: true };
  });
  await revoke.ready();
  await signIn(revoke);
  buttonByText(revoke.member, 'Revoke all devices').click();
  await settle();
  assert.ok(revoke.calls.some(call => call.action === 'revokeAllDevices'));
  assert.equal(revoke.cookies[COOKIE], undefined);
});

test('administrator tools run on the member token with live role, including backup-code recovery', async () => {
  let memberCode = CODE;
  const target = profile({ memberId: 'MEM-X', characterName: 'Forgetful', isAdmin: false });
  const app = createHarness((action, data) => {
    if (action === 'restore') return { member: profile({ isAdmin: true }), session: session('admin-member-token') };
    if (action === 'adminMembers') return [{ ...target, activeSessions: 2, backupCodeSet: true }];
    if (action === 'adminRead') return target;
    if (action === 'adminBackupCode') {
      assert.equal(data.memberId, 'MEM-X');
      return { memberId: 'MEM-X', characterName: 'Forgetful', backupCode: memberCode, backupCodeSet: true };
    }
    if (action === 'adminRegenerateBackupCode') {
      memberCode = 'BPSR-NEWW-CODE-HERE';
      return { backupCode: memberCode, profile: target };
    }
    if (action === 'adminRevokeSessions') return target;
    if (action === 'adminDuplicates' || action === 'adminAudit') return [];
  });
  await app.ready();
  await signIn(app);
  assert.equal(app.administration.hidden, false, 'admin section opens from the live role');
  app.calls.filter(call => call.action.startsWith('admin')).forEach(call => {
    assert.equal(call.data.token, 'admin-member-token', call.action + ' must use the member session token');
  });
  app.admin.querySelector('[data-member-id="MEM-X"]').click();
  await settle();
  assert.match(app.admin.textContent, /Backup codeSet/);
  assert.match(app.admin.textContent, /Active devices/);
  buttonByText(app.admin, 'Reveal backup code').click();
  await settle();
  assert.match(app.admin.textContent, new RegExp(CODE));
  buttonByText(app.admin, 'Regenerate backup code').click();
  await settle();
  const regen = app.calls.find(call => call.action === 'adminRegenerateBackupCode');
  assert.equal(regen.data.memberId, 'MEM-X');
  assert.equal(regen.data.revokeSessions, true, 'second confirm opts into revoking devices');
  assert.match(app.admin.textContent, /BPSR-NEWW-CODE-HERE/);
  buttonByText(app.admin, 'Revoke all devices').click();
  await settle();
  assert.ok(app.calls.some(call => call.action === 'adminRevokeSessions'));
});

test('ordinary members never see admin controls and hostile names render as text', async () => {
  const hostile = profile({ memberId: 'MEM-X', characterName: '<img src=x onerror=alert(1)>', isAdmin: false });
  const app = createHarness((action) => {
    if (action === 'restore') return { member: profile({ isAdmin: true }), session: session('admin-member-token') };
    if (action === 'adminMembers') return [hostile];
    if (action === 'adminRead') return hostile;
    if (action === 'adminDuplicates' || action === 'adminAudit') return [];
  });
  await app.ready();
  await signIn(app);
  app.admin.querySelector('[data-member-id="MEM-X"]').click();
  await settle();
  assert.match(app.admin.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(app.admin.querySelectorAll('img').length, 0, 'hostile name is text, never parsed markup');

  const plain = createHarness((action) => {
    if (action === 'restore') return { member: profile({ isAdmin: false }), session: session('plain-token') };
  });
  await plain.ready();
  await signIn(plain);
  assert.equal(plain.administration.hidden, true);
});

test('the emergency recovery secret opens admin tools in memory only', async () => {
  const app = createHarness((action, data) => {
    if (action === 'adminLogin') {
      assert.equal(data.secret, 'super-secret');
      return { session: { token: 'recovery-token', expiresAt: future() }, recovery: true };
    }
    if (action === 'adminMembers' || action === 'adminDuplicates' || action === 'adminAudit') return [];
    if (action === 'logout') return { ok: true };
  });
  await app.ready();
  buttonByText(app.member, 'Open recovery controls').click();
  await settle();
  const recoveryForm = formByButton(app.admin, 'Use recovery secret');
  recoveryForm.querySelector('input[name="secret"]').value = 'super-secret';
  recoveryForm.dispatch('submit');
  await settle(14);
  assert.match(app.admin.textContent, /Emergency recovery session active/);
  assert.equal(Object.keys(app.store).length, 0, 'recovery token never touches storage');
  assert.equal(app.cookies[COOKIE], undefined, 'recovery token never touches the cookie');
  buttonByText(app.admin, 'End recovery session').click();
  await settle();
  assert.equal(app.calls.filter(call => call.action === 'logout').at(-1).data.kind, 'admin');
});
