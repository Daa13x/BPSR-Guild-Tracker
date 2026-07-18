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

function future() { return new Date(Date.now() + 60 * 60 * 1000).toISOString(); }
function session(token) { return { token, expiresAt: future() }; }
function profile(overrides) {
  return {
    memberId: 'MEM-1',
    characterName: 'Dax',
    svFloor: 12,
    masterPoints: 480,
    masterRanks: { ACT1: 2 },
    isAdmin: false,
    disabled: false,
    ...(overrides || {})
  };
}

function createHarness(handler, options) {
  const opts = options || {};
  const document = new Document();
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
  base('div', 'firsts');
  base('p', 'stamp');

  const store = { ...(opts.store || {}) };
  const calls = [];
  const defaultHandler = (action, data) => {
    if (action === 'activities') return [{ id: 'ACT1', name: 'Trial', maxRank: 20 }];
    if (action === 'adminMembers' || action === 'adminDuplicates' || action === 'adminAudit') return [];
    if (action === 'logout') return { ok: true };
    return {};
  };
  const fetch = (url, request) => {
    const envelope = JSON.parse(request.body);
    calls.push({ url, action: envelope.action, data: envelope.data });
    let result;
    try { result = (handler || defaultHandler)(envelope.action, envelope.data, calls); }
    catch (failure) { result = Promise.reject(failure); }
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
    calls,
    store,
    ui: ctx.BPSR_FRONTEND,
    ready: async () => { document.fire('DOMContentLoaded'); await settle(); },
    settle
  };
}

async function settle(rounds = 8) {
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

test('preview notice reflects the real unified configuration state', async () => {
  const preview = createHarness(null, { configured: false });
  await preview.ready();
  assert.equal(preview.preview.hidden, false);

  const connected = createHarness();
  await connected.ready();
  assert.equal(connected.preview.hidden, true);
});

test('member registration and login forms submit character name and PIN', async () => {
  const app = createHarness((action, data) => {
    if (action === 'register') return { member: profile({ characterName: data.characterName }), session: session('member-register') };
    if (action === 'activities') return [];
    return [];
  });
  await app.ready();
  const registration = formByButton(app.member, 'Register');
  registration.querySelector('input[name="characterName"]').value = 'New Guildie';
  registration.querySelector('input[name="pin"]').value = '123456';
  registration.dispatch('submit');
  await settle();
  assert.deepEqual(app.calls.find(call => call.action === 'register').data, {
    characterName: 'New Guildie', pin: '123456'
  });
  assert.match(app.member.textContent, /Signed in as New Guildie/);

  const loginApp = createHarness((action, data) => {
    if (action === 'login') return { member: profile({ characterName: data.characterName }), session: session('member-login') };
    if (action === 'activities') return [];
    return [];
  });
  await loginApp.ready();
  const login = formByButton(loginApp.member, 'Sign in');
  login.querySelector('input[name="characterName"]').value = 'Dax';
  login.querySelector('input[name="pin"]').value = '654321';
  login.dispatch('submit');
  await settle();
  assert.deepEqual(loginApp.calls.find(call => call.action === 'login').data, {
    characterName: 'Dax', pin: '654321'
  });
  assert.equal(loginApp.store['bpsr.admin.session'], undefined);
});

test('profile renders and progression sends SV and ranks without browser totals', async () => {
  let resolveProgress;
  const progressPending = new Promise(resolve => { resolveProgress = resolve; });
  const app = createHarness((action, data) => {
    if (action === 'login') return { member: profile(), session: session('member-token') };
    if (action === 'activities') return [{ id: 'ACT1', name: 'Trial', maxRank: 20 }];
    if (action === 'progress') return progressPending;
    if (action === 'leaderboard') return {};
    return [];
  });
  await app.ready();
  formByButton(app.member, 'Sign in').dispatch('submit');
  await settle();
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
  assert.deepEqual(progressCalls[0].data.masterRanks, { ACT1: '4' });
  assert.equal(progressCalls[0].data.svFloor, '15');
  assert.equal('masterPoints' in progressCalls[0].data, false);
  resolveProgress({ changed: true, profile: profile({ svFloor: 15 }) });
  await settle();
  assert.match(app.member.querySelector('.notice').textContent, /Progress updated/);
});

test('member restore keeps and separately validates the stored administrator session', async () => {
  const initialMember = session('old-member');
  const initialAdmin = session('stored-admin');
  const app = createHarness((action, data) => {
    if (action === 'refresh' && data.kind === 'member') {
      return { profile: profile({ isAdmin: true }), expiresAt: future() };
    }
    if (action === 'refresh' && data.kind === 'admin') return { expiresAt: future() };
    if (action === 'activities') return [];
    if (action.startsWith('admin')) return [];
    if (action === 'logout') return { ok: true };
    return {};
  }, { store: {
    'bpsr.member.session': JSON.stringify({ ...initialMember, kind: 'member', display: 'Dax' }),
    'bpsr.admin.session': JSON.stringify({ ...initialAdmin, kind: 'admin', display: 'Dax' })
  } });
  await app.ready();
  assert.equal(app.calls.some(call => call.action === 'me'), false);
  assert.equal(JSON.parse(app.store['bpsr.admin.session']).token, 'stored-admin');
  const refreshes = app.calls.filter(call => call.action === 'refresh');
  assert.deepEqual(refreshes.map(call => [call.data.kind, call.data.token]), [
    ['member', 'old-member'], ['admin', 'stored-admin']
  ]);
  assert.equal(app.administration.hidden, false);
  buttonByText(app.member, 'Sign out').click();
  await settle();
  const logouts = app.calls.filter(call => call.action === 'logout');
  assert.deepEqual(logouts.map(call => call.data.kind), ['member']);
  assert.equal(app.store['bpsr.member.session'], undefined);
  assert.equal(JSON.parse(app.store['bpsr.admin.session']).token, 'stored-admin');
});

test('administrator selection, edit, role, disable, duplicate, reset and audit flows use stable IDs', async () => {
  let selected = profile({ memberId: 'MEM-X', characterName: '<img src=x onerror=alert(1)>', isAdmin: false });
  const app = createHarness((action, data) => {
    if (action === 'login') return {
      member: profile({ isAdmin: true }),
      session: session('member-admin'),
      adminSession: session('admin-token')
    };
    if (action === 'activities') return [];
    if (action === 'adminMembers') return [{
      memberId: 'MEM-X', characterName: selected.characterName, svFloor: selected.svFloor,
      masterPoints: selected.masterPoints, isAdmin: selected.isAdmin, disabled: selected.disabled
    }];
    if (action === 'adminRead') return selected;
    if (action === 'adminEdit') {
      selected = { ...selected, characterName: data.characterName, svFloor: Number(data.svFloor) };
      return selected;
    }
    if (action === 'adminSetRole') { selected = { ...selected, isAdmin: data.isAdmin }; return selected; }
    if (action === 'adminSetDisabled') { selected = { ...selected, disabled: data.disabled }; return selected; }
    if (action === 'adminDuplicates') return [{
      normalizedName: 'duplicate', memberIds: ['MEM-K', 'MEM-R'], members: [
        profile({ memberId: 'MEM-K', characterName: 'Keep Me' }),
        profile({ memberId: 'MEM-R', characterName: 'Remove Me' })
      ]
    }];
    if (action === 'adminMerge') return profile({ memberId: data.keepMemberId, characterName: 'Keep Me' });
    if (action === 'adminAudit') return [
      { at: '2026-07-18', action: 'SET_ADMIN_ROLE', target: 'MEM-X', details: 'Promoted' },
      { at: '2026-07-18', action: 'EDIT_MEMBER', target: 'MEM-X', details: 'Corrected' }
    ];
    if (action === 'adminReset' || action === 'adminCorrectAchievement') return { ok: true };
    return {};
  });
  await app.ready();
  formByButton(app.member, 'Sign in').dispatch('submit');
  await settle(15);
  assert.equal(JSON.parse(app.store['bpsr.admin.session']).token, 'admin-token');

  const memberRow = app.admin.querySelector('[data-member-id="MEM-X"]');
  memberRow.click();
  await settle();
  assert.equal(app.ui.state.selected, 'MEM-X');
  assert.match(app.admin.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(app.admin.querySelectorAll('img').length, 0, 'hostile name is text, never parsed markup');
  assert.equal(app.admin.querySelector('input[name="characterName"]').value, selected.characterName);

  const edit = formByButton(app.admin, 'Save member');
  edit.querySelector('input[name="characterName"]').value = 'Safe Name';
  edit.querySelector('input[name="svFloor"]').value = '20';
  edit.dispatch('submit');
  await settle(15);
  const editCall = app.calls.find(call => call.action === 'adminEdit');
  assert.equal(editCall.data.memberId, 'MEM-X');

  buttonByText(app.admin, 'Make administrator').click();
  await settle(15);
  const roleCall = app.calls.find(call => call.action === 'adminSetRole');
  assert.deepEqual({ memberId: roleCall.data.memberId, isAdmin: roleCall.data.isAdmin }, {
    memberId: 'MEM-X', isAdmin: true
  });

  buttonByText(app.admin, 'Disable member').click();
  await settle(15);
  const disableCall = app.calls.find(call => call.action === 'adminSetDisabled');
  assert.deepEqual({ memberId: disableCall.data.memberId, disabled: disableCall.data.disabled }, {
    memberId: 'MEM-X', disabled: true
  });

  const duplicateRows = app.admin.querySelectorAll('.duplicate-row');
  buttonByText(duplicateRows[0], 'Keep').click();
  buttonByText(duplicateRows[1], 'Remove').click();
  await settle(2);
  formByButton(app.admin, 'Merge selected duplicates').dispatch('submit');
  await settle(15);
  const mergeCall = app.calls.find(call => call.action === 'adminMerge');
  assert.deepEqual({ keepMemberId: mergeCall.data.keepMemberId, removeMemberId: mergeCall.data.removeMemberId }, {
    keepMemberId: 'MEM-K', removeMemberId: 'MEM-R'
  });

  buttonByText(app.admin, 'Start new update period').click();
  await settle(12);
  assert.ok(app.calls.some(call => call.action === 'adminReset'));

  const correction = formByButton(app.admin, 'Save achievement correction');
  correction.querySelector('input[name="achievementId"]').value = 'ACH-1';
  correction.querySelector('input[name="achievementName"]').value = 'Dax';
  correction.querySelector('input[name="notes"]').value = 'Verified';
  correction.dispatch('submit');
  await settle(12);
  const correctionCall = app.calls.find(call => call.action === 'adminCorrectAchievement');
  assert.deepEqual({
    achievementId: correctionCall.data.achievementId,
    characterName: correctionCall.data.characterName,
    notes: correctionCall.data.notes
  }, { achievementId: 'ACH-1', characterName: 'Dax', notes: 'Verified' });
  assert.equal(app.admin.querySelectorAll('#admin-audit li').length, 2);
});

test('administrator logout is isolated and repeated rendering does not duplicate controls', async () => {
  const app = createHarness((action, data) => {
    if (action === 'login') return {
      member: profile({ isAdmin: true }), session: session('member-live'), adminSession: session('admin-live')
    };
    if (action === 'activities' || action.startsWith('admin')) return [];
    if (action === 'logout') return { ok: true };
    return {};
  });
  await app.ready();
  formByButton(app.member, 'Sign in').dispatch('submit');
  await settle(12);
  const firstCount = app.admin.querySelectorAll('form').length;
  app.ui.renderAdmin();
  app.ui.renderAdmin();
  await settle(12);
  assert.equal(app.admin.querySelectorAll('form').length, firstCount);
  buttonByText(app.admin, 'End administrator session').click();
  await settle();
  const logout = app.calls.filter(call => call.action === 'logout').at(-1);
  assert.equal(logout.data.kind, 'admin');
  assert.ok(app.store['bpsr.member.session']);
  assert.equal(app.store['bpsr.admin.session'], undefined);
  assert.equal(app.ui.state.selected, null);
});

test('ending administrator access stays closed across ordinary member refresh', async () => {
  const app = createHarness((action, data) => {
    if (action === 'login') return {
      member: profile({ isAdmin: true }), session: session('member-live'), adminSession: session('admin-live')
    };
    if (action === 'refresh' && data.kind === 'member') {
      return { profile: profile({ isAdmin: true }), expiresAt: future() };
    }
    if (action === 'activities' || action.startsWith('admin')) return [];
    if (action === 'logout') return { ok: true };
    return {};
  });
  await app.ready();
  formByButton(app.member, 'Sign in').dispatch('submit');
  await settle(12);
  buttonByText(app.admin, 'End administrator session').click();
  await settle();
  assert.equal(app.store['bpsr.admin.session'], undefined);
  const refreshCount = app.calls.filter(call => call.action === 'refresh' && call.data.kind === 'member').length;
  await app.ui.restore('member');
  await settle();
  assert.equal(app.calls.filter(call => call.action === 'refresh' && call.data.kind === 'member').length, refreshCount + 1);
  assert.equal(app.store['bpsr.admin.session'], undefined);
  assert.equal(buttonByText(app.admin, 'Start administrator session'), undefined);
  assert.match(app.admin.querySelector('.notice').textContent, /Sign out of your member account and sign in again/);
});

test('expired sessions clear only their own storage and API errors stay in the correct interface', async () => {
  const expired = new Date(Date.now() - 1000).toISOString();
  const app = createHarness((action, data) => {
    if (action === 'refresh' && data.kind === 'admin') return { expiresAt: future() };
    if (action === 'adminMembers') throw new ApiFailure('REQUEST_FAILED', 'Admin list failed safely.');
    if (action === 'adminDuplicates' || action === 'adminAudit') return [];
    return {};
  }, { store: {
    'bpsr.member.session': JSON.stringify({ token: 'member-expired', expiresAt: expired, kind: 'member' }),
    'bpsr.admin.session': JSON.stringify({ token: 'admin-live', expiresAt: future(), kind: 'admin' })
  } });
  await app.ready();
  assert.equal(app.store['bpsr.member.session'], undefined);
  assert.ok(app.store['bpsr.admin.session']);
  assert.match(app.admin.querySelector('.notice').textContent, /Admin list failed safely/);
  assert.equal(app.member.querySelector('.notice').classList.contains('error'), false);

  const memberError = createHarness((action) => {
    if (action === 'login') throw new ApiFailure('INVALID_CREDENTIALS', 'Invalid character name or PIN.');
    return [];
  });
  await memberError.ready();
  formByButton(memberError.member, 'Sign in').dispatch('submit');
  await settle();
  assert.match(memberError.member.querySelector('.notice').textContent, /Invalid character name or PIN/);
  assert.equal(memberError.admin.querySelector('.notice').classList.contains('error'), false);
});
