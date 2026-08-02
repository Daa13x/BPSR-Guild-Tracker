/* Build-free member and administrator controller for the static tracker.
 * Passwordless accounts: a remembered-device cookie holds only an opaque
 * session token; the backend decides identity and role on every request. */
(function (root) {
  'use strict';

  var CONFIG = root.BPSR_CONFIG || {
    apiUrl: '',
    timeoutMs: 45000,
    isConfigured: function () { return false; }
  };
  var LEGACY_KEYS = { member: 'bpsr.member.session', admin: 'bpsr.admin.session' };
  var state = {
    member: null,
    session: null,
    recoveryToken: null,
    backupCode: null,
    codeAcknowledged: true,
    selected: null,
    selectedProfile: null,
    activities: [],
    mySeal: null
  };

  function configured() {
    return CONFIG.isConfigured ? CONFIG.isConfigured() : Boolean(CONFIG.apiUrl);
  }

  function api(action, data) {
    if (!configured()) {
      return Promise.reject(Object.assign(
        new Error('API URL is not configured. Set configuredApiUrl in config.js to the Apps Script /exec URL.'),
        { code: 'CONFIGURATION' }
      ));
    }
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs || 45000);
    return root.fetch(CONFIG.apiUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: data || {} }),
      signal: controller.signal
    }).then(function (response) {
      return response.text();
    }).then(function (text) {
      var envelope;
      try { envelope = JSON.parse(text); } catch (_) {
        throw new Error('The API returned an invalid response.');
      }
      if (!envelope.ok) {
        var failure = new Error(
          envelope.error && envelope.error.message || 'Request could not be completed.'
        );
        failure.code = envelope.error && envelope.error.code;
        throw failure;
      }
      return envelope.data;
    }).catch(function (failure) {
      if (failure && failure.name === 'AbortError') {
        throw new Error('The request timed out. Check the connection and try again.');
      }
      throw failure;
    }).finally(function () {
      root.clearTimeout(timer);
    });
  }

  // -------------------------------------------------------------------------
  // Remembered-device cookie — an opaque token only; never the account itself
  // -------------------------------------------------------------------------

  function secureContext() {
    return Boolean(root.location && root.location.protocol === 'https:');
  }

  function cookieName() {
    return secureContext() ? '__Secure-bpsr-member-session' : 'bpsr-member-session';
  }

  function cookiePath() {
    var pathname = (root.location && root.location.pathname) || '/';
    return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
  }

  function readCookie() {
    var target = cookieName() + '=';
    var parts = String(root.document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var candidate = parts[i].trim();
      if (candidate.indexOf(target) === 0) return decodeURIComponent(candidate.slice(target.length));
    }
    return '';
  }

  function writeCookie(token, expiresAt) {
    var seconds = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    if (!isFinite(seconds) || seconds < 60) seconds = 180 * 24 * 60 * 60;
    var cookie = cookieName() + '=' + encodeURIComponent(token) +
      '; Path=' + cookiePath() + '; Max-Age=' + seconds + '; SameSite=Lax';
    if (secureContext()) cookie += '; Secure';
    root.document.cookie = cookie;
  }

  function clearCookie() {
    var cookie = cookieName() + '=; Path=' + cookiePath() + '; Max-Age=0; SameSite=Lax';
    if (secureContext()) cookie += '; Secure';
    root.document.cookie = cookie;
  }

  function readLegacy(kind) {
    try {
      return JSON.parse(root.localStorage.getItem(LEGACY_KEYS[kind]) || 'null');
    } catch (_) {
      return null;
    }
  }

  function removeLegacy() {
    try {
      root.localStorage.removeItem(LEGACY_KEYS.member);
      root.localStorage.removeItem(LEGACY_KEYS.admin);
    } catch (_) { /* best effort */ }
  }

  function signedOutLocally() {
    clearCookie();
    state.member = null;
    state.session = null;
    state.backupCode = null;
    state.codeAcknowledged = true;
    state.mySeal = null;
    syncAdminVisibility(Boolean(state.recoveryToken));
    renderMember();
    renderAdmin();
  }

  // -------------------------------------------------------------------------
  // Small DOM helpers
  // -------------------------------------------------------------------------

  function E(tag, text) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  function field(labelText, name, type, placeholder) {
    var wrap = E('label');
    wrap.className = 'field';
    var label = E('span', labelText);
    var control = E('input');
    control.name = name;
    control.type = type || 'text';
    control.placeholder = placeholder || '';
    wrap.appendChild(label);
    wrap.appendChild(control);
    return { wrap: wrap, input: control };
  }

  function notice(kind, message, isError) {
    var node = document.querySelector('#' + kind + '-ui .notice');
    if (!node) return;
    node.className = 'notice' + (isError ? ' error' : '');
    node.textContent = message;
  }

  /** Never show a bare "API error", "Unknown action" or "Server error".
   * Deliberate validation messages are already written for people and pass
   * through; everything else is classified and the raw detail is logged. */
  var ACCOUNTS_UNAVAILABLE = 'Accounts are unavailable because the deployed Apps Script backend does not yet ' +
    'include the required account and Master Seal actions. Deploy the updated Apps Script version to enable ' +
    'sign-in and character accounts.';

  function friendlyFailure(failure) {
    if (!root.BPSR_ERRORS) return (failure && failure.message) || 'That request could not be completed.';
    var classified = root.BPSR_ERRORS.classify(failure, 'account');
    if (classified.kind === 'expected') return classified.title;
    if (classified.kind === 'not-deployed') return ACCOUNTS_UNAVAILABLE;
    return classified.detail ? classified.title + ' — ' + classified.detail : classified.title;
  }

  function syncAdminVisibility(show) {
    var section = document.getElementById('administration');
    var nav = document.querySelector('[data-admin-nav]');
    if (section) section.hidden = !show;
    if (nav) nav.hidden = !show;
  }

  function handleError(kind, failure) {
    if (failure && failure.code === 'SESSION_EXPIRED') {
      if (kind === 'member') {
        signedOutLocally();
        showGate('returning');
      } else {
        state.recoveryToken = null;
        syncAdminVisibility(Boolean(state.member && state.member.isAdmin));
        renderAdmin();
      }
      return;
    }
    notice(kind, friendlyFailure(failure), true);
  }

  function actionButton(text, kind, action) {
    var button = E('button', text);
    button.type = 'button';
    button.addEventListener('click', function () {
      if (button.disabled) return;
      button.disabled = true;
      Promise.resolve().then(action).catch(function (failure) {
        handleError(kind, failure);
      }).finally(function () {
        button.disabled = false;
      });
    });
    return button;
  }

  function copyText(value, done) {
    var finish = function (ok) { if (done) done(ok); };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(value).then(function () { finish(true); }, function () { finish(false); });
    } else {
      finish(false);
    }
  }

  function memberToken() {
    return state.session ? state.session.token : '';
  }

  function adminToken() {
    return state.recoveryToken || memberToken();
  }

  // -------------------------------------------------------------------------
  // First-visit gate — "Who are you?"
  // -------------------------------------------------------------------------

  function hideGate() {
    var gate = document.getElementById('gate');
    if (gate) {
      gate.hidden = true;
      gate.replaceChildren();
    }
  }

  function showGate(activeTab) {
    var gate = document.getElementById('gate');
    if (!gate || !configured()) return;
    gate.replaceChildren();
    gate.hidden = false;

    var card = E('div');
    card.className = 'gate-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'gate-title');
    gate.appendChild(card);

    card.appendChild(E('p', 'ONLYPAWS GUILD')).className = 'eyebrow';
    var title = E('h2', 'Who are you?');
    title.id = 'gate-title';
    card.appendChild(title);
    card.appendChild(E('p', 'This tracker remembers you on this browser — no password needed.')).className = 'gate-sub';

    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');

    var tabs = E('div');
    tabs.className = 'gate-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Account paths');
    var panels = E('div');

    var newTab = E('button', 'New user');
    var returningTab = E('button', 'Returning user');
    [newTab, returningTab].forEach(function (tab, index) {
      tab.type = 'button';
      tab.className = 'gate-tab';
      tab.setAttribute('role', 'tab');
      tab.id = index === 0 ? 'gate-tab-new' : 'gate-tab-returning';
      tabs.appendChild(tab);
    });
    card.appendChild(tabs);
    card.appendChild(message);
    card.appendChild(panels);

    var newPanel = E('form');
    newPanel.className = 'gate-panel';
    newPanel.setAttribute('role', 'tabpanel');
    newPanel.setAttribute('aria-labelledby', 'gate-tab-new');
    newPanel.appendChild(E('h3', 'Create your account'));
    var newName = field('Character name', 'characterName', 'text', 'Enter your character name');
    newName.input.autocomplete = 'username';
    newPanel.appendChild(newName.wrap);
    var createButton = E('button', 'Create my account');
    createButton.type = 'submit';
    newPanel.appendChild(createButton);

    var returningPanel = E('form');
    returningPanel.className = 'gate-panel';
    returningPanel.setAttribute('role', 'tabpanel');
    returningPanel.setAttribute('aria-labelledby', 'gate-tab-returning');
    returningPanel.appendChild(E('h3', 'Restore your account'));
    var returningName = field('Character name', 'characterName', 'text', 'Enter your character name');
    returningName.input.autocomplete = 'username';
    var codeField = field('Backup code', 'backupCode', 'text', 'BPSR-____-____-____');
    codeField.input.autocomplete = 'one-time-code';
    codeField.input.spellcheck = false;
    returningPanel.appendChild(returningName.wrap);
    returningPanel.appendChild(codeField.wrap);
    var restoreButton = E('button', 'Restore access');
    restoreButton.type = 'submit';
    returningPanel.appendChild(restoreButton);
    var lost = E('p', 'Lost your backup code? Contact Dax or another guild administrator.');
    lost.className = 'gate-hint';
    returningPanel.appendChild(lost);

    panels.appendChild(newPanel);
    panels.appendChild(returningPanel);

    function selectTab(which) {
      var isNew = which !== 'returning';
      newTab.setAttribute('aria-selected', String(isNew));
      returningTab.setAttribute('aria-selected', String(!isNew));
      newTab.tabIndex = isNew ? 0 : -1;
      returningTab.tabIndex = isNew ? -1 : 0;
      newPanel.hidden = !isNew;
      returningPanel.hidden = isNew;
      (isNew ? newName : returningName).input.focus();
    }
    newTab.addEventListener('click', function () { selectTab('new'); });
    returningTab.addEventListener('click', function () { selectTab('returning'); });
    tabs.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectTab(newTab.getAttribute('aria-selected') === 'true' ? 'returning' : 'new');
    });

    newPanel.addEventListener('submit', function (event) {
      event.preventDefault();
      if (createButton.disabled) return;
      createButton.disabled = true;
      api('createAccount', { characterName: newName.input.value }).then(function (result) {
        adoptSession(result, { showCode: true });
      }).catch(function (failure) {
        if (failure && failure.code === 'DUPLICATE') {
          selectTab('returning');
          returningName.input.value = newName.input.value;
          codeField.input.focus();
        }
        message.className = 'notice error';
        message.textContent = friendlyFailure(failure);
      }).finally(function () {
        createButton.disabled = false;
      });
    });

    returningPanel.addEventListener('submit', function (event) {
      event.preventDefault();
      if (restoreButton.disabled) return;
      restoreButton.disabled = true;
      api('restore', { characterName: returningName.input.value, backupCode: codeField.input.value }).then(function (result) {
        adoptSession(result, { showCode: false });
      }).catch(function (failure) {
        message.className = 'notice error';
        message.textContent = friendlyFailure(failure);
      }).finally(function () {
        restoreButton.disabled = false;
      });
    });

    var browse = E('button', 'Continue without an account — view the leaderboards only');
    browse.type = 'button';
    browse.className = 'gate-browse';
    browse.addEventListener('click', hideGate);
    card.appendChild(browse);

    selectTab(activeTab === 'returning' ? 'returning' : 'new');
  }

  function adoptSession(result, options) {
    state.session = { token: result.session.token, expiresAt: result.session.expiresAt };
    state.member = result.member;
    writeCookie(result.session.token, result.session.expiresAt);
    removeLegacy();
    if (options && options.showCode && result.backupCode) {
      state.backupCode = result.backupCode;
      state.codeAcknowledged = false;
    }
    hideGate();
    syncAdminVisibility(Boolean(state.member.isAdmin || state.recoveryToken));
    renderMember();
    if (state.member.isAdmin) renderAdmin();
    if (root.load) root.load();
    if (root.loadMasterSeal) root.loadMasterSeal();
  }

  // -------------------------------------------------------------------------
  // Backup-code presentation
  // -------------------------------------------------------------------------

  function codeSavePanel(host) {
    var panel = E('section');
    panel.className = 'code-panel';
    panel.setAttribute('aria-label', 'Backup code');
    panel.appendChild(E('h3', 'Please save this somewhere'));
    panel.appendChild(E('p', 'Your backup code:'));
    var code = E('strong', state.backupCode);
    code.className = 'code-value';
    panel.appendChild(code);
    panel.appendChild(E('p', 'You will need this code if you lose access to this browser.'));
    var row = E('div');
    row.className = 'code-actions';
    var copy = E('button', 'Copy code');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      copyText(state.backupCode, function (ok) {
        copy.textContent = ok ? 'Copied' : 'Copy failed — write it down';
      });
    });
    var saved = E('button', 'I have saved it');
    saved.type = 'button';
    saved.addEventListener('click', function () {
      state.codeAcknowledged = true;
      renderMember();
    });
    row.appendChild(copy);
    row.appendChild(saved);
    panel.appendChild(row);
    host.appendChild(panel);
  }

  function codeInlineControl(host) {
    var wrap = E('div');
    wrap.className = 'code-inline';
    wrap.appendChild(E('span', 'Backup access'));
    var value = E('code', '••••-••••-••••');
    var revealed = false;
    var reveal = E('button', 'Reveal');
    reveal.type = 'button';
    reveal.addEventListener('click', function () {
      if (revealed) {
        revealed = false;
        value.textContent = '••••-••••-••••';
        reveal.textContent = 'Reveal';
        return;
      }
      Promise.resolve(state.backupCode || api('myBackupCode', { token: memberToken() }).then(function (result) {
        state.backupCode = result.backupCode;
        return result.backupCode;
      })).then(function (code) {
        revealed = true;
        value.textContent = code || 'No code on file — ask an administrator';
        reveal.textContent = 'Hide';
      }).catch(function (failure) {
        handleError('member', failure);
      });
    });
    var copy = E('button', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      Promise.resolve(state.backupCode || api('myBackupCode', { token: memberToken() }).then(function (result) {
        state.backupCode = result.backupCode;
        return result.backupCode;
      })).then(function (code) {
        copyText(code, function (ok) {
          copy.textContent = ok ? 'Copied' : 'Copy failed';
          root.setTimeout(function () { copy.textContent = 'Copy'; }, 2500);
        });
      }).catch(function (failure) {
        handleError('member', failure);
      });
    });
    wrap.appendChild(value);
    wrap.appendChild(reveal);
    wrap.appendChild(copy);
    host.appendChild(wrap);
  }

  // -------------------------------------------------------------------------
  // Member area
  // -------------------------------------------------------------------------

  function renderMember() {
    // The Master Seal editor lives in its own section; keep it in sync with
    // sign-in state on every member re-render.
    renderSealEditor();
    // Tell the board who is signed in so the detail panel opens on their row.
    if (root.MS_PAGE && root.MS_PAGE.setViewer) {
      root.MS_PAGE.setViewer(state.member ? state.member.characterName : null);
    }
    // Refresh the personal class selector for the current sign-in state.
    if (root.CLASS_SELECTOR && root.CLASS_SELECTOR.reload) root.CLASS_SELECTOR.reload();
    var host = document.getElementById('member-ui');
    if (!host) return;
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);

    if (!state.session || !state.member) {
      syncAdminVisibility(Boolean(state.recoveryToken));
      message.textContent = configured()
        ? 'No account is remembered on this browser yet.'
        : 'Set the Apps Script URL in config.js to connect accounts and progression.';
      if (configured()) {
        var open = E('button', 'Create account or restore access');
        open.type = 'button';
        open.className = 'btn';
        open.addEventListener('click', function () { showGate('new'); });
        host.appendChild(open);
        var recovery = E('details');
        recovery.appendChild(E('summary', 'Emergency administrator recovery'));
        recovery.appendChild(actionButton('Open recovery controls', 'member', function () {
          var section = document.getElementById('administration');
          if (section) {
            section.hidden = false;
            renderAdmin();
            if (section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth' });
          }
        }));
        host.appendChild(recovery);
      }
      return;
    }

    var profile = state.member;
    syncAdminVisibility(Boolean(profile.isAdmin || state.recoveryToken));
    message.textContent = 'Signed in as ' + profile.characterName + ' on this remembered device.';
    if (profile.isAdmin) {
      var badge = E('span', 'Administrator');
      badge.className = 'pill';
      message.appendChild(badge);
    }

    if (state.backupCode && !state.codeAcknowledged) codeSavePanel(host);
    else codeInlineControl(host);

    var metrics = E('div');
    metrics.className = 'metric-grid compact';
    [['SV floor', String(profile.svFloor || 0)],
     ['Master points', String(profile.masterPoints || 0)],
     ['Master Seal', state.mySeal ? String(state.mySeal.totals.totalScore) + ' / ' + String(state.mySeal.season.maxScore) : '—']]
      .forEach(function (pair) {
        var cardNode = E('div');
        cardNode.className = 'metric-card';
        cardNode.appendChild(E('span', pair[0]));
        cardNode.appendChild(E('strong', pair[1]));
        metrics.appendChild(cardNode);
      });
    host.appendChild(metrics);

    var sessionRow = E('div');
    sessionRow.className = 'session-actions';
    sessionRow.appendChild(actionButton('Sign out of this device', 'member', function () {
      return api('logout', { token: memberToken(), kind: 'member' }).catch(function () { /* revoke is best effort */ })
        .then(function () {
          signedOutLocally();
          showGate('returning');
        });
    }));
    sessionRow.appendChild(actionButton('Revoke all devices', 'member', function () {
      if (!root.confirm('Sign this account out of every remembered browser? You will need your backup code to return.')) return;
      return api('revokeAllDevices', { token: memberToken() }).then(function () {
        signedOutLocally();
        showGate('returning');
      });
    }));
    host.appendChild(sessionRow);
  }

  // -------------------------------------------------------------------------
  // Master Seal — the member edits only their own six dungeons
  // -------------------------------------------------------------------------

  /** One editable row: a labelled value box and, for dungeons, a Master-level
   * dropdown. The Stim Vault is a floors value with no Master level, so it
   * omits the dropdown. "Cleared" is derived — any value or level counts. */
  function sealRow(key, label, record, maxLevel, maxScore, opts) {
    var o = opts || {};
    var group = E('fieldset');
    group.className = 'seal-edit' + (o.withLevel === false ? ' seal-edit-single' : '');
    group.dataset.seal = key;
    group.appendChild(E('legend', label));

    var points = field(o.valueLabel || 'Points', 'points-' + key, 'number', '0');
    points.input.min = '0';
    points.input.max = String(o.valueMax || maxScore);
    points.input.inputMode = 'numeric';
    points.input.value = record && record.points ? String(record.points) : '0';
    points.wrap.className = 'field seal-points';
    group.appendChild(points.wrap);

    if (o.withLevel !== false) {
      var levelWrap = E('label');
      levelWrap.className = 'field seal-level';
      levelWrap.appendChild(E('span', 'Master level'));
      var level = document.createElement('select');
      level.name = 'level-' + key;
      var none = document.createElement('option');
      none.value = ''; none.textContent = 'Not cleared';
      level.appendChild(none);
      for (var i = 0; i <= maxLevel; i++) {
        var option = document.createElement('option');
        option.value = String(i); option.textContent = 'M' + i;
        level.appendChild(option);
      }
      level.value = record && record.bestMasterLevel !== null && record.bestMasterLevel !== undefined
        ? String(record.bestMasterLevel) : '';
      levelWrap.appendChild(level);
      group.appendChild(levelWrap);
    }
    return group;
  }

  /** Read one row into the {cleared, bestMasterLevel, points} entry shape.
   * A row with no dropdown (Stim Vault) never carries a Master level. */
  function readSealRow(group) {
    var select = group.querySelector('select');
    var level = select ? select.value : '';
    var points = Number(group.querySelector('input[type="number"]').value || 0);
    var hasLevel = level !== '';
    var cleared = hasLevel || points > 0;
    return { cleared: cleared, bestMasterLevel: hasLevel ? Number(level) : null, points: cleared ? points : 0 };
  }

  /** Render the Master Seal editor into its own section. Stim Vault leads,
   * then the six dungeons; a single Save sits at the bottom. */
  function renderSealEditor() {
    var host = document.getElementById('seal-ui');
    if (!host) return;
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);

    if (!state.session || !memberToken()) {
      message.textContent = configured()
        ? 'Sign in from My Progress to record your Master Seal and Stim Vault progress.'
        : 'Connect the Apps Script API to record Master Seal progress.';
      return;
    }

    var form = E('form');
    form.className = 'progress-card seal-form';
    var grid = E('div');
    grid.className = 'seal-edit-grid';
    grid.textContent = 'Loading your Master Seal progress…';
    form.appendChild(grid);

    var footer = E('div');
    footer.className = 'seal-save-row';
    var submit = E('button', 'Save Master Seal progress');
    submit.type = 'submit';
    submit.className = 'btn';
    submit.disabled = true;
    footer.appendChild(submit);
    form.appendChild(footer);
    host.appendChild(form);

    api('myMasterSeal', { token: memberToken() }).then(function (mine) {
      state.mySeal = mine;
      grid.replaceChildren();
      // Stim Vault first — a floors value with no Master level, resets biweekly.
      var stim = mine.stimVault || { points: 0, bestMasterLevel: null };
      var stimRow = sealRow('stim-vault', 'Stim Vault', stim, mine.season.maxMasterLevel, mine.season.maxScore,
        { withLevel: false, valueLabel: 'Floors', valueMax: stim.max || 60 });
      if (mine.stimVault && mine.stimVault.nextResetAt) {
        var note = E('p', 'Resets ' + fmtSealDate(mine.stimVault.nextResetAt) + (mine.stimVault.justReset ? ' · just reset for the new fortnight' : ''));
        note.className = 'seal-reset-note';
        stimRow.appendChild(note);
      }
      grid.appendChild(stimRow);
      // Then the six dungeons in order.
      mine.season.dungeons.forEach(function (dungeon) {
        var record = null;
        mine.dungeons.forEach(function (d) { if (d.dungeonId === dungeon.id) record = d; });
        grid.appendChild(sealRow(dungeon.id, dungeon.name, record, mine.season.maxMasterLevel, mine.season.maxScore));
      });
      submit.disabled = false;
      renderSealMetric();
    }).catch(function (failure) {
      grid.textContent = '';
      message.className = 'notice error';
      message.textContent = friendlyFailure(failure);
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      var dungeons = {}, stimVault = null;
      grid.querySelectorAll('fieldset[data-seal]').forEach(function (group) {
        var key = group.dataset.seal;
        if (key === 'stim-vault') stimVault = readSealRow(group);
        else dungeons[key] = readSealRow(group);
      });
      api('masterSealUpdate', { token: memberToken(), dungeons: dungeons, stimVault: stimVault }).then(function (result) {
        if (state.mySeal) {
          state.mySeal.dungeons = result.dungeons;
          state.mySeal.totals = result.totals;
          state.mySeal.stimVault = result.stimVault;
        }
        // The Stim Vault floor is the SV floor, so keep the member profile and
        // the SV/Masters boards in step after saving.
        if (state.member && result.stimVault) state.member.svFloor = result.stimVault.points;
        message.className = 'notice';
        message.textContent = result.changed ? 'Master Seal progress saved.' : 'No Master Seal changes.';
        renderSealMetric();
        if (root.load) root.load();
        if (root.loadMasterSeal) root.loadMasterSeal();
      }).catch(function (failure) {
        message.className = 'notice error';
        message.textContent = friendlyFailure(failure);
      }).finally(function () {
        submit.disabled = false;
      });
    });
  }

  function fmtSealDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderSealMetric() {
    var cards = document.querySelectorAll('#member-ui .metric-card');
    if (cards.length >= 3 && state.mySeal) {
      cards[2].querySelector('strong').textContent =
        String(state.mySeal.totals.totalScore) + ' / ' + String(state.mySeal.season.maxScore);
    }
  }

  // -------------------------------------------------------------------------
  // Administration — the member session is the credential; role is live
  // -------------------------------------------------------------------------

  function selectedDetails(profile) {
    state.selectedProfile = profile;
    var details = document.getElementById('admin-details');
    if (details) {
      details.replaceChildren();
      var rows = [
        ['Character', profile.characterName],
        ['Member ID', profile.memberId],
        ['SV floor', profile.svFloor],
        ['Master points', profile.masterPoints],
        ['Role', profile.isAdmin ? 'Administrator' : 'Member'],
        ['Status', profile.disabled ? 'Disabled' : 'Active'],
        ['Visibility', profile.hidden ? 'Hidden from boards' : 'Visible'],
        ['Verified', profile.verified ? 'Yes' : 'No'],
        ['Backup code', profile.backupCodeSet ? 'Set · updated ' + (profile.backupCodeUpdatedAt || '').slice(0, 10) : 'Missing'],
        ['Last access', profile.lastAccessAt ? profile.lastAccessAt.slice(0, 10) : '—'],
        ['Active devices', profile.activeSessions]
      ];
      rows.forEach(function (row) {
        var item = E('div');
        item.className = 'detail-row';
        item.appendChild(E('span', row[0]));
        item.appendChild(E('strong', String(row[1])));
        details.appendChild(item);
      });
      details.appendChild(E('p', 'Master ranks: ' + JSON.stringify(profile.masterRanks || {})));
    }
    var name = document.querySelector('#admin-ui input[name="characterName"]');
    var sv = document.querySelector('#admin-ui input[name="svFloor"]');
    if (name) name.value = profile.characterName || '';
    if (sv) sv.value = profile.svFloor || '';
    var role = document.getElementById('admin-role-toggle');
    var disabled = document.getElementById('admin-disabled-toggle');
    if (role) role.textContent = profile.isAdmin ? 'Remove administrator role' : 'Make administrator';
    if (disabled) disabled.textContent = profile.disabled ? 'Enable member' : 'Disable member';
    var hide = document.getElementById('admin-hidden-toggle');
    if (hide) hide.textContent = profile.hidden ? 'Show on leaderboards' : 'Hide from leaderboards';
    var verify = document.getElementById('admin-verified-toggle');
    if (verify) verify.textContent = profile.verified ? 'Remove verified mark' : 'Grant verified mark';
    var codeValue = document.getElementById('admin-code-value');
    if (codeValue) codeValue.textContent = 'Hidden — use Reveal';
  }

  function adminCard(title, description) {
    var card = E('section');
    card.className = 'admin-card';
    card.appendChild(E('h3', title));
    if (description) card.appendChild(E('p', description));
    return card;
  }

  function renderAdmin() {
    var host = document.getElementById('admin-ui');
    if (!host) return;
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);

    var token = adminToken();
    var isAdminMember = Boolean(state.member && state.member.isAdmin && state.session);

    if (!isAdminMember && !state.recoveryToken) {
      message.textContent = 'Administrator access comes from a member account whose live role is administrator.';
      var recovery = E('details');
      var summary = E('summary', 'Emergency recovery');
      var recoveryForm = E('form');
      var secret = field('Recovery secret', 'secret', 'password', 'BPSR_ADMIN_SECRET');
      secret.input.autocomplete = 'current-password';
      var recover = E('button', 'Use recovery secret');
      recover.type = 'submit';
      recovery.appendChild(summary);
      recoveryForm.appendChild(E('p', 'Use only if no member administrator can sign in. The recovery session lives in memory and ends when this page closes.'));
      recoveryForm.appendChild(secret.wrap);
      recoveryForm.appendChild(recover);
      recovery.appendChild(recoveryForm);
      recoveryForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (recover.disabled) return;
        recover.disabled = true;
        api('adminLogin', { secret: secret.input.value }).then(function (result) {
          state.recoveryToken = result.session.token;
          syncAdminVisibility(true);
          renderAdmin();
        }).catch(function (failure) {
          handleError('admin', failure);
        }).finally(function () {
          recover.disabled = false;
        });
      });
      host.appendChild(recovery);
      return;
    }

    syncAdminVisibility(true);
    message.textContent = state.recoveryToken
      ? 'Emergency recovery session active. Every change is authorized and audited server-side.'
      : 'Administrator role active. Every change is authorized and audited server-side.';
    var adminGrid = E('div');
    adminGrid.className = 'admin-grid';
    host.appendChild(adminGrid);

    var membersCard = adminCard('Members', 'Search, select and review a guild member.');
    var search = field('Search members', 'search', 'search', 'Character name');
    var memberList = E('div');
    memberList.className = 'member-list';
    memberList.setAttribute('aria-live', 'polite');
    var details = E('div');
    details.id = 'admin-details';
    details.className = 'member-details empty-state';
    details.textContent = 'Select a member to view details.';
    membersCard.appendChild(search.wrap);
    membersCard.appendChild(memberList);
    membersCard.appendChild(details);
    adminGrid.appendChild(membersCard);

    function loadMembers() {
      memberList.textContent = 'Loading members…';
      return api('adminMembers', { token: token, query: search.input.value }).then(function (members) {
        memberList.replaceChildren();
        members.forEach(function (member) {
          var label = member.characterName + ' — SV ' + member.svFloor +
            (member.isAdmin ? ' — Administrator' : '') +
            (member.disabled ? ' — Disabled' : '') +
            (member.backupCodeSet ? '' : ' — No backup code') +
            ' — ' + member.activeSessions + ' device' + (member.activeSessions === 1 ? '' : 's');
          var select = actionButton(label, 'admin', function () {
            state.selected = member.memberId;
            return api('adminRead', { token: token, memberId: member.memberId })
              .then(selectedDetails);
          });
          select.className = 'member-row';
          select.dataset.memberId = member.memberId;
          memberList.appendChild(select);
        });
        if (!members.length) memberList.appendChild(E('p', 'No members match this search.'));
      });
    }
    search.input.addEventListener('input', function () {
      loadMembers().catch(function (failure) { handleError('admin', failure); });
    });

    var recoveryCard = adminCard('Backup access', 'Reveal, copy or regenerate a member’s backup code, or revoke their devices. Reveals and changes are audited.');
    var codeRow = E('div');
    codeRow.className = 'code-inline admin-code';
    codeRow.appendChild(E('span', 'Backup code'));
    var codeValue = E('code', 'Hidden — use Reveal');
    codeValue.id = 'admin-code-value';
    codeRow.appendChild(codeValue);
    recoveryCard.appendChild(codeRow);
    recoveryCard.appendChild(actionButton('Reveal backup code', 'admin', function () {
      if (!state.selected) throw new Error('Select a member first.');
      return api('adminBackupCode', { token: token, memberId: state.selected }).then(function (result) {
        codeValue.textContent = result.backupCodeSet ? result.backupCode : 'No code on file — regenerate one';
      });
    }));
    recoveryCard.appendChild(actionButton('Copy backup code', 'admin', function () {
      if (!state.selected) throw new Error('Select a member first.');
      return api('adminBackupCode', { token: token, memberId: state.selected }).then(function (result) {
        if (!result.backupCodeSet) throw new Error('No code on file — regenerate one.');
        copyText(result.backupCode, function (ok) {
          notice('admin', ok ? 'Backup code copied.' : 'Copy failed — use Reveal and copy manually.', !ok);
        });
      });
    }));
    recoveryCard.appendChild(actionButton('Regenerate backup code', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      if (!root.confirm('Regenerate the backup code for ' + state.selectedProfile.characterName + '? The old code stops working immediately.')) return;
      var revoke = root.confirm('Also sign this member out of every remembered device?');
      return api('adminRegenerateBackupCode', { token: token, memberId: state.selected, revokeSessions: revoke }).then(function (result) {
        selectedDetails(result.profile);
        codeValue.textContent = result.backupCode;
        notice('admin', 'Backup code regenerated' + (revoke ? ' and devices revoked.' : '.'));
      });
    }));
    recoveryCard.appendChild(actionButton('Revoke all devices', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      if (!root.confirm('Sign ' + state.selectedProfile.characterName + ' out of every remembered device?')) return;
      return api('adminRevokeSessions', { token: token, memberId: state.selected }).then(function (profile) {
        selectedDetails(profile);
        notice('admin', 'All remembered devices revoked.');
      });
    }));
    adminGrid.appendChild(recoveryCard);

    var editCard = adminCard('Selected member', 'Rename, correct SV or change account status and role.');
    var editForm = E('form');
    var characterName = field('Character name', 'characterName', 'text', 'Character name');
    var svFloor = field('SV floor', 'svFloor', 'number', '1–60');
    svFloor.input.min = '1';
    svFloor.input.max = '60';
    var saveMember = E('button', 'Save member');
    saveMember.type = 'submit';
    editForm.appendChild(characterName.wrap);
    editForm.appendChild(svFloor.wrap);
    editForm.appendChild(saveMember);
    editForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!state.selected) return handleError('admin', new Error('Select a member first.'));
      if (saveMember.disabled) return;
      saveMember.disabled = true;
      api('adminEdit', {
        token: token,
        memberId: state.selected,
        characterName: characterName.input.value || undefined,
        svFloor: svFloor.input.value || undefined
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll('Member updated.');
      }).catch(function (failure) {
        handleError('admin', failure);
      }).finally(function () {
        saveMember.disabled = false;
      });
    });
    editCard.appendChild(editForm);

    var roleButton = actionButton('Make administrator', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      var desired = !state.selectedProfile.isAdmin;
      var self = Boolean(state.member && state.member.memberId === state.selectedProfile.memberId);
      var warning = self && !desired ? 'Warning: this changes your own role. ' : '';
      if (!root.confirm(warning + 'Confirm ' + (desired ? 'promotion' : 'demotion') +
        ' for ' + state.selectedProfile.characterName + '?')) return;
      return api('adminSetRole', {
        token: token,
        memberId: state.selected,
        isAdmin: desired,
        confirmSelf: self && !desired
      }).then(function (profile) {
        selectedDetails(profile);
        if (self && !desired) {
          state.member.isAdmin = false;
          syncAdminVisibility(Boolean(state.recoveryToken));
          renderMember();
          return;
        }
        return refreshAll(desired ? 'Member promoted to administrator.' :
          'Administrator role removed; their session no longer authorizes admin actions.');
      });
    });
    roleButton.id = 'admin-role-toggle';
    editCard.appendChild(roleButton);

    var disableButton = actionButton('Disable member', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      var disabled = !state.selectedProfile.disabled;
      var warning = disabled ? ' All of this member’s sessions will be revoked.' : '';
      if (!root.confirm((disabled ? 'Disable ' : 'Enable ') +
        state.selectedProfile.characterName + '?' + warning)) return;
      return api('adminSetDisabled', {
        token: token,
        memberId: state.selected,
        disabled: disabled
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll(disabled ? 'Member disabled; sessions revoked.' : 'Member enabled.');
      });
    });
    disableButton.id = 'admin-disabled-toggle';
    editCard.appendChild(disableButton);

    var hideButton = actionButton('Hide from leaderboards', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      var hidden = !state.selectedProfile.hidden;
      return api('adminSetHidden', {
        token: token,
        memberId: state.selected,
        hidden: hidden
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll(hidden
          ? 'Member hidden from public boards. They still see their own row when signed in.'
          : 'Member shown on public boards again.');
      });
    });
    hideButton.id = 'admin-hidden-toggle';
    editCard.appendChild(hideButton);

    var verifyButton = actionButton('Grant verified mark', 'admin', function () {
      if (!state.selectedProfile) throw new Error('Select a member first.');
      var verified = !state.selectedProfile.verified;
      return api('adminSetVerified', {
        token: token,
        memberId: state.selected,
        verified: verified
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll(verified ? 'Verified mark granted.' : 'Verified mark removed.');
      });
    });
    verifyButton.id = 'admin-verified-toggle';
    editCard.appendChild(verifyButton);
    adminGrid.appendChild(editCard);

    var duplicateCard = adminCard(
      'Duplicate management',
      'Choose exactly which stable member record to keep and which to remove.'
    );
    var duplicates = E('div');
    duplicates.className = 'duplicate-groups';
    var mergeForm = E('form');
    var keep = field('Member ID to keep', 'keepMemberId', 'text', 'Choose from a duplicate group');
    var remove = field('Member ID to remove', 'removeMemberId', 'text', 'Choose from a duplicate group');
    keep.input.readOnly = true;
    remove.input.readOnly = true;
    var mergeWarning = E('p', 'Merging reassigns progression history (including Master Seal records) to the kept member and disables the removed member.');
    mergeWarning.className = 'notice warning';
    var mergeButton = E('button', 'Merge selected duplicates');
    mergeButton.type = 'submit';
    duplicateCard.appendChild(actionButton('Refresh duplicate groups', 'admin', loadDuplicates));
    duplicateCard.appendChild(duplicates);
    mergeForm.appendChild(mergeWarning);
    mergeForm.appendChild(keep.wrap);
    mergeForm.appendChild(remove.wrap);
    mergeForm.appendChild(mergeButton);
    duplicateCard.appendChild(mergeForm);
    adminGrid.appendChild(duplicateCard);

    function loadDuplicates() {
      duplicates.textContent = 'Loading duplicate groups…';
      return api('adminDuplicates', { token: token }).then(function (groups) {
        duplicates.replaceChildren();
        groups.forEach(function (group) {
          var groupNode = E('div');
          groupNode.className = 'duplicate-group';
          groupNode.appendChild(E('h4', 'Duplicate name: ' + group.normalizedName));
          var members = group.members || group.memberIds.map(function (memberId) {
            return { memberId: memberId, characterName: 'Member', isAdmin: false, disabled: false };
          });
          members.forEach(function (member) {
            var row = E('div');
            row.className = 'duplicate-row';
            row.appendChild(E('span', member.characterName + ' (' + member.memberId + ')' +
              (member.isAdmin ? ' — Administrator' : '') + (member.disabled ? ' — Disabled' : '')));
            row.appendChild(actionButton('Keep', 'admin', function () {
              keep.input.value = member.memberId;
            }));
            row.appendChild(actionButton('Remove', 'admin', function () {
              remove.input.value = member.memberId;
            }));
            groupNode.appendChild(row);
          });
          duplicates.appendChild(groupNode);
        });
        if (!groups.length) duplicates.appendChild(E('p', 'No duplicate groups found.'));
      });
    }
    mergeForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (mergeButton.disabled) return;
      if (!keep.input.value || !remove.input.value) {
        return handleError('admin', new Error('Choose the member to keep and the member to remove.'));
      }
      if (!root.confirm('Merge these records? This cannot be undone from the browser.')) return;
      mergeButton.disabled = true;
      api('adminMerge', {
        token: token,
        keepMemberId: keep.input.value,
        removeMemberId: remove.input.value
      }).then(function (profile) {
        state.selected = profile.memberId;
        selectedDetails(profile);
        return refreshAll('Duplicates merged; removed-member sessions revoked.');
      }).catch(function (failure) {
        handleError('admin', failure);
      }).finally(function () {
        mergeButton.disabled = false;
      });
    });

    var toolsCard = adminCard('Guild administration', 'Corrections and reset actions are written to the audit log.');
    var achievementForm = E('form');
    var achievementId = field('Achievement ID', 'achievementId', 'text', 'Achievement ID');
    var achievementName = field('Correct character name', 'achievementName', 'text', 'Character name');
    var notesField = field('Audit notes', 'notes', 'text', 'Why this correction is needed');
    var correct = E('button', 'Save achievement correction');
    correct.type = 'submit';
    achievementForm.appendChild(achievementId.wrap);
    achievementForm.appendChild(achievementName.wrap);
    achievementForm.appendChild(notesField.wrap);
    achievementForm.appendChild(correct);
    toolsCard.appendChild(achievementForm);
    toolsCard.appendChild(actionButton('Start new update period', 'admin', function () {
      if (!root.confirm('Start a new First Guildie period?')) return;
      return api('adminReset', { token: token }).then(function () {
        return refreshAll('New update period started.');
      });
    }));
    adminGrid.appendChild(toolsCard);
    achievementForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (correct.disabled) return;
      correct.disabled = true;
      api('adminCorrectAchievement', {
        token: token,
        achievementId: achievementId.input.value,
        characterName: achievementName.input.value,
        notes: notesField.input.value
      }).then(function () {
        return refreshAll('Achievement correction audited.');
      }).catch(function (failure) {
        handleError('admin', failure);
      }).finally(function () {
        correct.disabled = false;
      });
    });

    var auditCard = adminCard('Audit log', 'The 100 most recent protected changes.');
    var audit = E('ul');
    audit.id = 'admin-audit';
    audit.className = 'audit-list';
    auditCard.appendChild(audit);
    auditCard.appendChild(actionButton('Refresh audit log', 'admin', loadAudit));
    adminGrid.appendChild(auditCard);
    function loadAudit() {
      audit.textContent = 'Loading audit entries…';
      return api('adminAudit', { token: token }).then(function (rows) {
        audit.replaceChildren();
        rows.forEach(function (entry) {
          audit.appendChild(E('li', (entry.at || '') + ' — ' + entry.action + ' — ' +
            entry.target + ' — ' + entry.details));
        });
        if (!rows.length) audit.appendChild(E('li', 'No audited changes yet.'));
      });
    }

    if (state.recoveryToken) {
      host.appendChild(actionButton('End recovery session', 'admin', function () {
        return api('logout', { token: state.recoveryToken, kind: 'admin' }).catch(function () { /* best effort */ })
          .then(function () {
            state.recoveryToken = null;
            syncAdminVisibility(Boolean(state.member && state.member.isAdmin));
            renderAdmin();
          });
      }));
    }

    function refreshAll(successMessage) {
      var jobs = [loadMembers(), loadDuplicates(), loadAudit()];
      if (state.selected) {
        jobs.push(api('adminRead', { token: token, memberId: state.selected })
          .then(selectedDetails));
      }
      return Promise.all(jobs).then(function () {
        if (successMessage) notice('admin', successMessage);
        if (root.load) root.load();
        if (root.loadMasterSeal) root.loadMasterSeal();
      });
    }

    loadMembers().then(loadDuplicates).then(loadAudit).catch(function (failure) {
      handleError('admin', failure);
    });
  }

  // -------------------------------------------------------------------------
  // Boot: cookie first, then one-time migration of the legacy local session
  // -------------------------------------------------------------------------

  /** True only when the server itself rejected the session or identity.
   * Network failures, timeouts and backend outages must never destroy the
   * cookie or the one-time legacy migration credential. */
  function definitiveSessionFailure(failure) {
    return Boolean(failure && (failure.code === 'SESSION_EXPIRED' || failure.code === 'IDENTITY_MISMATCH'));
  }

  function retryLater(failure) {
    hideGate();
    renderMember();
    renderAdmin();
    var classified = root.BPSR_ERRORS ? root.BPSR_ERRORS.classify(failure, 'session restore') : null;
    var reason = classified && classified.kind === 'not-deployed'
      ? ACCOUNTS_UNAVAILABLE
      : 'The tracker could not reach the API to restore your remembered session.';
    notice('member', reason + ' Your saved access is kept — reload the page to try again.', true);
    return null;
  }

  function boot() {
    if (!configured()) {
      renderMember();
      renderAdmin();
      return Promise.resolve(null);
    }
    var token = readCookie();
    if (token) {
      return api('refresh', { token: token, kind: 'member' }).then(function (result) {
        state.session = { token: token, expiresAt: result.expiresAt };
        state.member = result.profile;
        hideGate();
        syncAdminVisibility(Boolean(result.profile.isAdmin));
        renderMember();
        renderAdmin();
        return result;
      }).catch(function (failure) {
        if (!definitiveSessionFailure(failure)) return retryLater(failure);
        clearCookie();
        return migrateLegacy();
      });
    }
    return migrateLegacy();
  }

  function migrateLegacy() {
    var legacy = readLegacy('member');
    if (legacy && legacy.token && new Date(legacy.expiresAt) > new Date()) {
      return api('migrate', { token: legacy.token }).then(function (result) {
        adoptSession(result, { showCode: true });
        return result;
      }).catch(function (failure) {
        if (!definitiveSessionFailure(failure)) return retryLater(failure);
        removeLegacy();
        renderMember();
        renderAdmin();
        showGate('new');
        return null;
      });
    }
    removeLegacy();
    renderMember();
    renderAdmin();
    showGate('new');
    return Promise.resolve(null);
  }

  function clearDemoPreview() {
    if (configured() || !root.DATA || !root.render) return;
    root.DATA = {
      generatedAt: new Date().toISOString(),
      config: {
        mountTarget: 3650,
        svMax: 60,
        outdatedDays: 14,
        firstGuildieEnabled: true,
        timezone: 'Europe/London'
      },
      svBoard: [],
      mpBoard: [],
      firstGuildie: { enabled: true, current: null, previous: [] },
      viewer: null,
      viewerCharacter: ''
    };
    root.render();
    var stamp = document.getElementById('stamp');
    if (stamp) stamp.textContent = 'Waiting for live guild data — backend not connected.';
  }

  root.BPSR_FRONTEND = {
    api: api,
    renderMember: renderMember,
    renderAdmin: renderAdmin,
    boot: boot,
    showGate: showGate,
    hideGate: hideGate,
    state: state,
    configured: configured,
    cookieName: cookieName,
    cookiePath: cookiePath
  };

  document.addEventListener('DOMContentLoaded', function () {
    var preview = document.getElementById('preview-notice');
    if (preview) preview.hidden = configured();
    clearDemoPreview();
    boot();
  });
}(window));
