/*
 * OnlyPaws — personal class & build selector.
 *
 * A compact trigger lives in the sidebar directly beneath "My Progress"; it
 * opens an anchored three-stage popover (entry type → class → build) and a
 * Manage view. Selections are personal and persisted through the existing
 * account API; they never touch the guild leaderboards. Uses the shared
 * catalogue (classes.js), session token (config.js), notifications (toast) and
 * failure classifier (BPSR_ERRORS).
 */
(function (root) {
  'use strict';

  var CAT = root.BPSR_CLASSES;
  var CONFIG = root.BPSR_CONFIG || {};
  if (!CAT || typeof document === 'undefined') return;

  var state = {
    selections: [],
    loaded: false,
    open: false,
    view: 'select',                 // 'select' | 'manage'
    busy: false,
    error: '',
    draft: { entryType: 'primary', classId: null, buildId: null, selectionId: null }
  };
  var els = {};                     // cached DOM refs
  var lastFocus = null;

  // --------------------------------------------------------------- helpers
  function token() { return root.BPSR_SESSION ? root.BPSR_SESSION.token() : ''; }
  function configured() { return CONFIG.isConfigured ? CONFIG.isConfigured() : Boolean(CONFIG.apiUrl); }
  function signedIn() { return Boolean(token()); }

  function api(action, data) {
    if (!configured()) return Promise.reject(Object.assign(new Error('Not configured.'), { code: 'CONFIGURATION' }));
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs || 15000);
    return root.fetch(CONFIG.apiUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: data || {} }),
      signal: controller.signal
    }).then(function (r) { return r.text(); }).then(function (text) {
      var env; try { env = JSON.parse(text); } catch (_) { throw Object.assign(new Error('Invalid response.'), { code: 'BAD_RESPONSE' }); }
      if (!env.ok) { var f = new Error((env.error && env.error.message) || 'Request failed.'); f.code = env.error && env.error.code; throw f; }
      return env.data;
    }).finally(function () { root.clearTimeout(timer); });
  }

  function describe(failure) {
    if (root.BPSR_ERRORS) {
      var c = root.BPSR_ERRORS.classify(failure, 'classes');
      if (c.kind === 'expected') return c.title;
      if (c.kind === 'not-deployed') return 'Class saving needs the updated Apps Script backend deployed.';
      return c.detail ? c.title + ' — ' + c.detail : c.title;
    }
    return (failure && failure.message) || 'That could not be completed.';
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function activeSelection() { return state.selections.filter(function (s) { return s.active; })[0] || null; }
  function primarySelection() { return state.selections.filter(function (s) { return s.entryType === 'primary'; })[0] || null; }
  function classOf(id) { return CAT.getClass(id); }
  function buildName(classId, buildId) { var c = classOf(classId); if (!c) return buildId; var b = c.builds.filter(function (x) { return x.id === buildId; })[0]; return b ? b.name : buildId; }

  /** A coloured, tinted class glyph (white source masked to the class colour). */
  function glyph(classId, size) {
    var g = el('span', 'cls-glyph');
    g.style.setProperty('--cls-colour', CAT.colourHex(classId) || '#fff');
    g.style.setProperty('--cls-icon', 'url("' + CAT.iconPath(classId) + '")');
    if (size) { g.style.width = size + 'px'; g.style.height = size + 'px'; }
    g.setAttribute('aria-hidden', 'true');
    return g;
  }

  function notify(msg) { if (typeof root.toast === 'function') root.toast(msg); }

  // --------------------------------------------------------------- collapsed trigger
  function ensureTrigger() {
    if (els.trigger) return;
    var host = document.getElementById('class-selector');
    if (!host) return;
    var btn = el('button', 'cls-trigger');
    btn.type = 'button';
    btn.id = 'cls-trigger';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () { state.open ? close() : open(); });
    host.appendChild(btn);
    els.trigger = btn;
  }

  function renderTrigger() {
    ensureTrigger();
    if (!els.trigger) return;
    var btn = els.trigger;
    var host = document.getElementById('class-selector');
    if (!signedIn()) { if (host) host.hidden = true; return; }
    if (host) host.hidden = false;
    btn.replaceChildren();
    var active = activeSelection();
    if (!active) {
      btn.classList.add('empty');
      btn.appendChild(el('span', 'cls-trigger-empty', state.loaded ? 'Set your class' : 'Loading…'));
      btn.appendChild(el('span', 'cls-chev', '⌄'));
      btn.setAttribute('aria-label', 'Choose your class');
      return;
    }
    btn.classList.remove('empty');
    btn.appendChild(glyph(active.classId, 26));
    var body = el('span', 'cls-trigger-body');
    body.appendChild(el('span', 'cls-trigger-name', classOf(active.classId).name));
    body.appendChild(el('span', 'cls-trigger-build', buildName(active.classId, active.buildId)));
    btn.appendChild(body);
    var badge = el('span', 'cls-badge ' + active.entryType, active.entryType.toUpperCase());
    btn.appendChild(badge);
    btn.appendChild(el('span', 'cls-chev', '⌄'));
    btn.setAttribute('aria-label', 'Class: ' + classOf(active.classId).name + ' ' + buildName(active.classId, active.buildId) + ', ' + active.entryType + '. Change class.');
  }

  // --------------------------------------------------------------- popover
  function open() {
    if (!signedIn()) { notify('Sign in to set your class.'); return; }
    lastFocus = document.activeElement;
    state.open = true;
    state.view = 'select';
    // Default the draft from the active selection so editing feels continuous.
    var active = activeSelection();
    state.draft = active
      ? { entryType: active.entryType, classId: active.classId, buildId: active.buildId, selectionId: active.id }
      : { entryType: primarySelection() ? 'secondary' : 'primary', classId: null, buildId: null, selectionId: null };
    state.error = '';
    buildPopover();
    els.trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', onOutside, true);
    root.addEventListener('resize', position);
    root.addEventListener('scroll', position, true);
    position();
    // Move focus into the popover.
    var first = els.pop.querySelector('button, [tabindex="0"]');
    if (first) first.focus();
  }

  function close() {
    state.open = false;
    if (els.pop && els.pop.parentNode) els.pop.parentNode.removeChild(els.pop);
    els.pop = null;
    if (els.trigger) els.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onOutside, true);
    root.removeEventListener('resize', position);
    root.removeEventListener('scroll', position, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab' && els.pop) {
      var f = els.pop.querySelectorAll('button:not([disabled]), input, [tabindex="0"]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function onOutside(e) { if (els.pop && !els.pop.contains(e.target) && e.target !== els.trigger && !els.trigger.contains(e.target)) close(); }

  function position() {
    if (!els.pop || !els.trigger) return;
    var r = els.trigger.getBoundingClientRect();
    var pop = els.pop;
    var narrow = root.innerWidth <= 640;
    if (narrow) { pop.classList.add('sheet'); return; }
    pop.classList.remove('sheet');
    var w = pop.offsetWidth || 430;
    var left = r.right + 10;
    if (left + w > root.innerWidth - 8) left = Math.max(8, r.left - w - 10);
    var top = Math.min(r.top, root.innerHeight - pop.offsetHeight - 8);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function buildPopover() {
    if (els.pop && els.pop.parentNode) els.pop.parentNode.removeChild(els.pop);
    var pop = el('div', 'cls-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-label', 'Class selector');
    els.pop = pop;
    document.body.appendChild(pop);
    render();
    position();
  }

  function render() {
    if (!els.pop) return;
    els.pop.replaceChildren();
    els.pop.appendChild(header());
    if (state.error) { els.pop.appendChild(el('div', 'cls-alert', state.error)); }
    if (state.view === 'manage') renderManage();
    else renderSelect();
  }

  function header() {
    var h = el('div', 'cls-head');
    var title = el('h3', 'cls-title', state.view === 'manage' ? 'Manage classes' : (state.draft.selectionId ? 'Edit class' : 'Choose class'));
    h.appendChild(title);
    var x = el('button', 'cls-x', '✕');
    x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', close);
    h.appendChild(x);
    return h;
  }

  // ---- Stage 1/2/3 select flow ----
  function renderSelect() {
    var body = el('div', 'cls-body');

    // Stage 1 — entry type
    var seg = el('div', 'cls-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Entry type');
    ['primary', 'secondary'].forEach(function (t) {
      var b = el('button', 'cls-seg-btn' + (state.draft.entryType === t ? ' on' : ''), t.toUpperCase());
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.draft.entryType === t));
      b.addEventListener('click', function () { state.draft.entryType = t; state.error = ''; render(); });
      seg.appendChild(b);
    });
    body.appendChild(labelled('Entry type', seg));
    if (state.draft.entryType === 'primary' && primarySelection() && primarySelection().id !== state.draft.selectionId) {
      body.appendChild(el('p', 'cls-hint', 'Saving as primary will replace your current primary (' + classOf(primarySelection().classId).name + ').'));
    }

    // Stage 2 — class grid
    var grid = el('div', 'cls-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'Class');
    CAT.catalogue.forEach(function (c) {
      var tile = el('button', 'cls-tile' + (state.draft.classId === c.id ? ' on' : ''));
      tile.type = 'button';
      tile.setAttribute('role', 'option');
      tile.setAttribute('aria-selected', String(state.draft.classId === c.id));
      tile.style.setProperty('--cls-colour', CAT.colourHex(c.id));
      tile.appendChild(glyph(c.id, 30));
      tile.appendChild(el('span', 'cls-tile-name', c.name));
      tile.addEventListener('click', function () {
        if (state.draft.classId !== c.id) {
          state.draft.classId = c.id;
          state.draft.buildId = null;   // changing class clears an incompatible build
          state.error = '';
          render();
        }
      });
      grid.appendChild(tile);
    });
    body.appendChild(labelled('Class', grid));

    // Stage 3 — builds of the chosen class
    if (state.draft.classId) {
      var c = classOf(state.draft.classId);
      var builds = el('div', 'cls-builds');
      builds.setAttribute('role', 'listbox');
      builds.setAttribute('aria-label', 'Build path for ' + c.name);
      c.builds.forEach(function (b) {
        var t = el('button', 'cls-build' + (state.draft.buildId === b.id ? ' on' : ''));
        t.type = 'button';
        t.setAttribute('role', 'option');
        t.setAttribute('aria-selected', String(state.draft.buildId === b.id));
        t.style.setProperty('--cls-colour', CAT.colourHex(c.id));
        t.appendChild(glyph(c.id, 22));
        t.appendChild(el('span', 'cls-build-name', b.name));
        t.addEventListener('click', function () { state.draft.buildId = b.id; state.error = ''; render(); });
        builds.appendChild(t);
      });
      body.appendChild(labelled('Build', builds));
    } else {
      body.appendChild(el('p', 'cls-hint', 'Choose a class to see its build paths.'));
    }

    els.pop.appendChild(body);
    els.pop.appendChild(selectFooter());
  }

  function labelled(text, node) {
    var wrap = el('div', 'cls-field');
    wrap.appendChild(el('p', 'cls-field-label', text));
    wrap.appendChild(node);
    return wrap;
  }

  function saveLabel() {
    if (state.draft.selectionId) return 'Save changes';
    return state.draft.entryType === 'primary' ? 'Save primary class' : 'Add secondary class';
  }

  function selectFooter() {
    var f = el('div', 'cls-foot');
    var manage = el('button', 'cls-link', 'Manage classes');
    manage.type = 'button';
    manage.addEventListener('click', function () { state.view = 'manage'; state.error = ''; render(); });
    f.appendChild(manage);
    var right = el('div', 'cls-foot-right');
    var cancel = el('button', 'cls-btn ghost', 'Cancel');
    cancel.type = 'button'; cancel.addEventListener('click', close);
    right.appendChild(cancel);
    var save = el('button', 'cls-btn primary', state.busy ? 'Saving…' : saveLabel());
    save.type = 'button';
    save.disabled = state.busy || !state.draft.classId || !state.draft.buildId;  // never default to Main
    save.addEventListener('click', doSave);
    right.appendChild(save);
    f.appendChild(right);
    return f;
  }

  function doSave() {
    if (state.busy || !state.draft.classId || !state.draft.buildId) return;
    // Client-side validation mirrors the server.
    var v = CAT.validate(state.draft.classId, state.draft.buildId);
    if (!v.ok) { state.error = v.error; render(); return; }
    state.busy = true; state.error = ''; render();
    api('saveClass', {
      token: token(),
      selectionId: state.draft.selectionId || undefined,
      entryType: state.draft.entryType,
      classId: state.draft.classId,
      buildId: state.draft.buildId
    }).then(function (data) {
      state.selections = data.selections || [];
      state.busy = false;
      notify(saveLabel().replace('Save', 'Saved').replace('Add', 'Added'));
      close();
      renderTrigger();
      updateActiveIndicators();
    }).catch(function (failure) {
      state.busy = false;
      state.error = describe(failure);
      render();  // keep the user's selections
    });
  }

  // ---- Manage view ----
  function renderManage() {
    var body = el('div', 'cls-body cls-manage');
    if (!state.selections.length) {
      body.appendChild(el('p', 'cls-hint', 'No classes saved yet. Use “Choose class” to add your primary.'));
    }
    var ordered = state.selections.slice().sort(function (a, b) {
      if (a.entryType !== b.entryType) return a.entryType === 'primary' ? -1 : 1;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    ordered.forEach(function (s) {
      var row = el('div', 'cls-mrow' + (s.active ? ' active' : ''));
      row.appendChild(glyph(s.classId, 26));
      var info = el('div', 'cls-minfo');
      var top = el('span', 'cls-mname');
      top.appendChild(document.createTextNode(classOf(s.classId).name + ' · ' + buildName(s.classId, s.buildId)));
      info.appendChild(top);
      var meta = el('span', 'cls-mmeta');
      meta.appendChild(el('span', 'cls-badge ' + s.entryType, s.entryType.toUpperCase()));
      if (s.active) meta.appendChild(el('span', 'cls-active-tag', 'ACTIVE'));
      info.appendChild(meta);
      row.appendChild(info);

      var acts = el('div', 'cls-macts');
      if (!s.active) acts.appendChild(mAct('Use', 'Switch to this configuration', function () { runManage('setActiveClass', { selectionId: s.id }); }));
      acts.appendChild(mAct('Edit', 'Edit this configuration', function () {
        state.draft = { entryType: s.entryType, classId: s.classId, buildId: s.buildId, selectionId: s.id };
        state.view = 'select'; state.error = ''; render();
      }));
      if (s.entryType === 'secondary') acts.appendChild(mAct('Promote', 'Make primary', function () {
        if (root.confirm('Make ' + classOf(s.classId).name + ' your primary class? Your current primary becomes secondary.')) runManage('promoteClass', { selectionId: s.id });
      }));
      if (s.entryType === 'secondary' || state.selections.length === 1) acts.appendChild(mAct('Remove', 'Remove this configuration', function () {
        if (root.confirm('Remove ' + classOf(s.classId).name + ' · ' + buildName(s.classId, s.buildId) + '?')) runManage('deleteClass', { selectionId: s.id });
      }, 'danger'));
      row.appendChild(acts);
      body.appendChild(row);
    });
    els.pop.appendChild(body);

    var f = el('div', 'cls-foot');
    var add = el('button', 'cls-link', '+ Add class');
    add.type = 'button';
    add.addEventListener('click', function () {
      state.draft = { entryType: primarySelection() ? 'secondary' : 'primary', classId: null, buildId: null, selectionId: null };
      state.view = 'select'; state.error = ''; render();
    });
    f.appendChild(add);
    var done = el('button', 'cls-btn ghost', 'Done');
    done.type = 'button'; done.addEventListener('click', close);
    var right = el('div', 'cls-foot-right'); right.appendChild(done);
    f.appendChild(right);
    els.pop.appendChild(f);
  }

  function mAct(label, aria, fn, kind) {
    var b = el('button', 'cls-mbtn' + (kind ? ' ' + kind : ''), label);
    b.type = 'button'; b.setAttribute('aria-label', aria + '');
    b.addEventListener('click', fn);
    return b;
  }

  function runManage(action, data) {
    if (state.busy) return;
    state.busy = true; state.error = ''; render();
    api(action, Object.assign({ token: token() }, data)).then(function (res) {
      state.selections = res.selections || [];
      state.busy = false; render();
      renderTrigger(); updateActiveIndicators();
    }).catch(function (failure) {
      state.busy = false; state.error = describe(failure); render();
    });
  }

  // --------------------------------------------------------------- active indicators
  function updateActiveIndicators() {
    var active = activeSelection();
    var text = active ? (classOf(active.classId).name + ' · ' + buildName(active.classId, active.buildId) + ' (' + active.entryType + ')') : '';
    var slots = document.querySelectorAll('[data-active-class]');
    slots.forEach(function (slot) {
      if (!active) { slot.hidden = true; slot.replaceChildren(); return; }
      slot.hidden = false;
      slot.replaceChildren();
      slot.appendChild(glyph(active.classId, 18));
      slot.appendChild(el('span', 'cls-active-text', text));
    });
  }

  // --------------------------------------------------------------- lifecycle
  function reload() {
    renderTrigger();
    if (!signedIn() || !configured()) { state.selections = []; state.loaded = true; renderTrigger(); updateActiveIndicators(); return; }
    api('myClasses', { token: token() }).then(function (data) {
      state.selections = data.selections || [];
      state.loaded = true;
      renderTrigger();
      updateActiveIndicators();
      if (state.open) render();
    }).catch(function (failure) {
      state.loaded = true;
      // Leave the trigger in its empty state; the popover surfaces the reason.
      state.error = describe(failure);
      renderTrigger();
    });
  }

  root.CLASS_SELECTOR = { reload: reload, state: state, open: open, close: close };

  document.addEventListener('DOMContentLoaded', function () { renderTrigger(); reload(); });
}(typeof window === 'undefined' ? globalThis : window));
