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
    mySeal: null,
    accounts: null,
    switchingAccount: false,
    accountEpoch: 0,
    mySealKey: '',
    // Migration preview confirm token — held on durable app state (NOT a
    // per-render closure) so re-rendering the admin panel between Preview and
    // Execute cannot drop it. Transient in-memory only; the backend also
    // stores and single-use-validates it server-side.
    ghConfirm: null
  };
  var surfaceLoadInFlight = null;
  var sealLoadInFlight = null, sealLoadKey = '';

  function configured() {
    return CONFIG.isConfigured ? CONFIG.isConfigured() : Boolean(CONFIG.apiUrl);
  }

  var RETRYABLE_READS = {
    refresh: true, myMasterSeal: true, myClasses: true, leaderboard: true, masterSeal: true,
    listAccessibleAccounts: true, previewAltAccount: true, adminMembers: true,
    adminRead: true, adminDuplicates: true, adminAudit: true
  };

  function api(action, data, retried) {
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
        throw Object.assign(new Error('The API returned an invalid response.'), { code: 'BAD_RESPONSE' });
      }
      if (!envelope.ok) {
        var failure = new Error(
          envelope.error && envelope.error.message || 'Request could not be completed.'
        );
        failure.code = envelope.error && envelope.error.code;
        throw failure;
      }
      if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
        throw Object.assign(new Error('The API returned an incomplete response.'), { code: 'BAD_RESPONSE' });
      }
      return envelope.data;
    }).catch(function (failure) {
      if (!retried && RETRYABLE_READS[action] && failure && failure.code === 'BAD_RESPONSE') {
        return api(action, data, true);
      }
      if (failure && failure.name === 'AbortError') {
        throw new Error('The request timed out. Check the connection and try again.');
      }
      throw failure;
    }).finally(function () {
      root.clearTimeout(timer);
    });
  }

  /** Run Apps Script readers one at a time. Apps Script executions can become
   * very slow when the same browser starts every sheet reader concurrently. */
  function queueSurfaceLoad(force, includePersonal) {
    if (surfaceLoadInFlight && !force) return surfaceLoadInFlight;
    var epoch = state.accountEpoch;
    var previous = surfaceLoadInFlight || Promise.resolve();
    var job = previous.catch(function () { return null; }).then(function () {
      if (epoch !== state.accountEpoch) return null;
      return root.loadMasterSeal ? root.loadMasterSeal(Boolean(force)) : null;
    }).then(function () {
      if (epoch !== state.accountEpoch) return null;
      return root.load ? root.load(Boolean(force)) : null;
    }).then(function () {
      if (!includePersonal || epoch !== state.accountEpoch || state.switchingAccount || !state.session) return null;
      return renderSealEditor({ force: Boolean(force) });
    }).then(function () {
      if (!includePersonal || epoch !== state.accountEpoch || state.switchingAccount || !state.session) return null;
      return root.CLASS_SELECTOR && root.CLASS_SELECTOR.reload
        ? root.CLASS_SELECTOR.reload(Boolean(force)) : null;
    });
    var wrapped = job.finally(function () {
      if (surfaceLoadInFlight === wrapped) surfaceLoadInFlight = null;
    });
    surfaceLoadInFlight = wrapped;
    return wrapped;
  }

  function loadRequiredSurfaces(force) {
    return queueSurfaceLoad(Boolean(force), true);
  }

  function loadPublicSurfaces(force) {
    return queueSurfaceLoad(Boolean(force), false);
  }

  function activeSealDefinition(fallback) {
    var staticData = root.BPSR_STATIC && root.BPSR_STATIC.get ? root.BPSR_STATIC.get() : null;
    return staticData && staticData.masterSeal ? staticData.masterSeal : fallback;
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
    state.accountEpoch++;
    clearCookie();
    state.member = null;
    state.session = null;
    state.backupCode = null;
    state.codeAcknowledged = true;
    state.mySeal = null;
    state.accounts = null;
    state.switchingAccount = false;
    state.mySealKey = '';
    sealLoadInFlight = null; sealLoadKey = '';
    if (root.CLASS_SELECTOR && root.CLASS_SELECTOR.reset) root.CLASS_SELECTOR.reset();
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
    state.accountEpoch++;
    state.session = { token: result.session.token, expiresAt: result.session.expiresAt };
    state.member = result.member;
    state.mySeal = null; state.mySealKey = '';
    sealLoadInFlight = null; sealLoadKey = '';
    writeCookie(result.session.token, result.session.expiresAt);
    removeLegacy();
    if (options && options.showCode && result.backupCode) {
      state.backupCode = result.backupCode;
      state.codeAcknowledged = false;
    }
    hideGate();
    syncAdminVisibility(Boolean(state.member.isAdmin || state.recoveryToken));
    if (root.CLASS_SELECTOR && root.CLASS_SELECTOR.reset) root.CLASS_SELECTOR.reset();
    renderMember();
    if (state.member.isAdmin) renderAdmin();
    loadRequiredSurfaces(true);
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
  // Linked-account chooser. The token remains opaque in the cookie; selecting
  // an account only changes the server-side active account after authorisation.
  // -------------------------------------------------------------------------

  function refreshAccessibleAccounts() {
    if (!memberToken()) return Promise.resolve(null);
    var epoch = state.accountEpoch;
    return api('listAccessibleAccounts', { token: memberToken() }).then(function (accounts) {
      if (epoch === state.accountEpoch) state.accounts = accounts;
      return accounts;
    });
  }

  function closeAccountChooser() {
    var modal = document.getElementById('account-switch-modal');
    if (modal) modal.remove();
  }

  function showAccountChooser() {
    if (!state.session || state.switchingAccount) return;
    closeAccountChooser();
    var modal = E('div');
    modal.id = 'account-switch-modal'; modal.className = 'account-switch-modal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'account-switch-title');
    var card = E('section'); card.className = 'account-switch-card'; modal.appendChild(card);
    var head = E('div'); head.className = 'account-switch-head';
    var title = E('h2', 'Choose account'); title.id = 'account-switch-title'; head.appendChild(title);
    var close = E('button', '×'); close.type = 'button'; close.className = 'account-switch-close'; close.setAttribute('aria-label', 'Close account chooser');
    close.addEventListener('click', closeAccountChooser); head.appendChild(close); card.appendChild(head);
    var noticeNode = E('p', 'Loading linked accounts…'); noticeNode.className = 'account-switch-notice'; card.appendChild(noticeNode);
    var list = E('div'); list.className = 'account-switch-list'; card.appendChild(list);
    var tools = E('div'); tools.className = 'account-switch-tools'; card.appendChild(tools);
    function error(message) { noticeNode.textContent = message; noticeNode.className = 'account-switch-notice error'; }
    function render(accounts) {
      list.replaceChildren();
      noticeNode.textContent = accounts.canManage ? 'Your main account and linked alt characters.' : 'This direct alt login can access this account only.';
      accounts.accounts.forEach(function (account) {
        var row = E('button'); row.type = 'button'; row.className = 'account-switch-row' + (account.active ? ' active' : '');
        row.disabled = account.active;
        var avatar = E('span', String(account.characterName || '?').charAt(0).toUpperCase()); avatar.className = 'account-switch-avatar'; row.appendChild(avatar);
        var copy = E('span'); copy.className = 'account-switch-copy'; copy.appendChild(E('strong', account.characterName));
        copy.appendChild(E('small', account.isMain ? 'Main' : 'Alt · SV floor ' + account.svFloor)); row.appendChild(copy);
        if (account.active) row.appendChild(E('span', 'Active'));
        if (!account.isMain && accounts.canManage) {
          var unlink = E('button', 'Unlink'); unlink.type = 'button'; unlink.className = 'account-unlink';
          unlink.addEventListener('click', function (event) {
            event.preventDefault(); event.stopPropagation();
            if (!root.confirm('Unlink ' + account.characterName + '? Their tracker data will not be deleted.')) return;
            unlink.disabled = true;
            api('unlinkAltAccount', { token: memberToken(), memberId: account.memberId }).then(function (updated) {
              state.accounts = updated; if (state.member && state.member.memberId === account.memberId) switchActiveAccount(updated.mainMemberId);
              else render(updated);
            }).catch(function (failure) { error(friendlyFailure(failure)); unlink.disabled = false; });
          });
          row.appendChild(unlink);
        }
        row.addEventListener('click', function () { if (!account.active) switchActiveAccount(account.memberId); });
        list.appendChild(row);
      });
      if (!accounts.canManage) return;
      var link = E('button', 'Use recovery code'); link.type = 'button'; link.className = 'btn ghost';
      link.addEventListener('click', function () {
        tools.replaceChildren();
        var form = E('form'); form.className = 'account-link-form';
        form.appendChild(E('p', 'Enter the existing alt character recovery code to prove you control it.'));
        var code = field('Alt recovery code', 'alt-code', 'text', 'BPSR-XXXX-XXXX-XXXX'); code.input.autocomplete = 'off'; form.appendChild(code.wrap);
        var verify = E('button', 'Verify account'); verify.type = 'submit'; verify.className = 'btn'; form.appendChild(verify);
        form.addEventListener('submit', function (event) {
          event.preventDefault(); verify.disabled = true;
          api('previewAltAccount', { token: memberToken(), backupCode: code.input.value }).then(function (candidate) {
            form.replaceChildren(); form.appendChild(E('p', 'Add ' + candidate.characterName + ' as an alt character?'));
            var confirm = E('button', 'Add ' + candidate.characterName); confirm.type = 'button'; confirm.className = 'btn'; form.appendChild(confirm);
            confirm.addEventListener('click', function () {
              confirm.disabled = true;
              api('linkAltAccount', { token: memberToken(), backupCode: code.input.value }).then(function (updated) { state.accounts = updated; tools.replaceChildren(); render(updated); })
                .catch(function (failure) { error(friendlyFailure(failure)); confirm.disabled = false; });
            });
          }).catch(function (failure) { error(friendlyFailure(failure)); verify.disabled = false; });
        });
        tools.appendChild(form); code.input.focus();
      });
      var createAlt = E('button', 'Create new alt'); createAlt.type = 'button'; createAlt.className = 'btn ghost';
      createAlt.addEventListener('click', function () {
        tools.replaceChildren();
        var form = E('form'); form.className = 'account-link-form';
        form.appendChild(E('p', 'Create a new alt character linked to this main account. You will receive one recovery code for it.'));
        var name = field('Alt character name', 'alt-character-name', 'text', 'Enter character name'); name.input.autocomplete = 'off'; form.appendChild(name.wrap);
        var submit = E('button', 'Create and link character'); submit.type = 'submit'; submit.className = 'btn'; form.appendChild(submit);
        form.addEventListener('submit', function (event) {
          event.preventDefault(); submit.disabled = true;
          api('createAltAccount', { token: memberToken(), characterName: name.input.value }).then(function (result) {
            state.accounts = result.accounts;
            form.replaceChildren();
            form.appendChild(E('p', result.account.characterName + ' is now linked as an alt character. Save this recovery code before closing.'));
            var code = E('output', result.backupCode); code.className = 'backup-code'; form.appendChild(code);
            var copy = E('button', 'Copy recovery code'); copy.type = 'button'; copy.className = 'btn ghost'; copy.addEventListener('click', function () { copyText(result.backupCode).then(function () { copy.textContent = 'Copied'; }).catch(function () { copy.textContent = 'Copy failed'; }); }); form.appendChild(copy);
            var switchButton = E('button', 'Switch to ' + result.account.characterName); switchButton.type = 'button'; switchButton.className = 'btn'; switchButton.addEventListener('click', function () { switchButton.disabled = true; switchActiveAccount(result.account.memberId); closeAccountChooser(); }); form.appendChild(switchButton);
          }).catch(function (failure) { error(friendlyFailure(failure)); submit.disabled = false; });
        });
        tools.appendChild(form); name.input.focus();
      });
      var addAccount = E('button', 'Add alt account'); addAccount.type = 'button'; addAccount.className = 'btn';
      addAccount.addEventListener('click', function () {
        tools.replaceChildren();
        tools.appendChild(E('p', 'Add an existing alt with its recovery code, or create a new alt character.'));
        tools.appendChild(link); tools.appendChild(createAlt);
      });
      tools.appendChild(addAccount);
    }
    modal.addEventListener('click', function (event) { if (event.target === modal) closeAccountChooser(); });
    modal.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeAccountChooser(); });
    document.body.appendChild(modal); close.focus();
    // The signed-in refresh already receives the accessible-account summary.
    // Render that cached, authorized result immediately so opening this menu
    // never waits on a duplicate Apps Script/Sheets read. Refresh afterwards
    // only to pick up a link or unlink made in another tab.
    var cachedAccounts = state.accounts && Array.isArray(state.accounts.accounts) ? state.accounts : null;
    // Older API deployments may restore a valid profile without the optional
    // account summary. Keep the account-management paths reachable for the
    // signed-in owner while the background request catches up. The backend is
    // still the authority for every link, switch and creation action.
    if (!cachedAccounts && state.member) {
      cachedAccounts = {
        mainMemberId: state.member.memberId,
        activeMemberId: state.member.memberId,
        canManage: true,
        accounts: [{
          memberId: state.member.memberId,
          characterName: state.member.characterName,
          svFloor: state.member.svFloor || 0,
          masterPoints: state.member.masterPoints || 0,
          isMain: true,
          active: true
        }]
      };
    }
    if (cachedAccounts) render(cachedAccounts);
    refreshAccessibleAccounts().then(function (accounts) { if (document.body.contains(modal) && accounts) render(accounts); })
      .catch(function (failure) { if (!cachedAccounts) error(friendlyFailure(failure)); });
  }

  function switchActiveAccount(memberId) {
    var epoch = ++state.accountEpoch;
    state.switchingAccount = true; state.mySeal = null;
    state.mySealKey = ''; sealLoadInFlight = null; sealLoadKey = '';
    if (root.CLASS_SELECTOR && root.CLASS_SELECTOR.reset) root.CLASS_SELECTOR.reset();
    renderMember();
    // Let an already-running Apps Script read finish before changing the
    // server-side active account. This prevents old/new account bursts.
    var beforeSwitch = surfaceLoadInFlight || Promise.resolve();
    return beforeSwitch.catch(function () { return null; }).then(function () {
      return api('switchActiveAccount', { token: memberToken(), memberId: memberId });
    }).then(function (result) {
      if (epoch !== state.accountEpoch) return;
      state.member = result.member; state.accounts = result.accounts; state.switchingAccount = false;
      closeAccountChooser();
      renderMember();
      if (root.MS_PAGE && root.MS_PAGE.setViewer) root.MS_PAGE.setViewer(state.member.characterName);
      return loadRequiredSurfaces(true);
    }).catch(function (failure) {
      if (epoch === state.accountEpoch) { state.switchingAccount = false; renderMember(); }
      throw failure;
    });
  }

  // -------------------------------------------------------------------------
  // Member area
  // -------------------------------------------------------------------------

  function renderMember() {
    // The Master Seal editor lives in its own section; keep it in sync with
    // sign-in state on every member re-render.
    renderSealEditor({ defer: true });
    // Tell the board who is signed in so the detail panel opens on their row.
    if (root.MS_PAGE && root.MS_PAGE.setViewer) {
      root.MS_PAGE.setViewer(state.member ? state.member.characterName : null);
    }
    // Refresh the personal class selector for the current sign-in state.
    if (root.CLASS_SELECTOR && root.CLASS_SELECTOR.sync) root.CLASS_SELECTOR.sync();
    var host = document.getElementById('member-ui');
    if (!host) return;
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);

    if (state.session && state.switchingAccount) {
      message.textContent = 'Switching account…';
      return;
    }
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
    sessionRow.appendChild(actionButton('Change Account', 'member', showAccountChooser));
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

  // NM Raid = Nightmare Mode raid (NOT Normal Mode). NM Raid and Easy/Hard Raid
  // are independent booleans — never one shared value.
  var SEAL_DIFFICULTIES = [
    { key: 'easy', label: 'Easy' },
    { key: 'hard', label: 'Hard' },
    { key: 'nmRaidCompleted', label: 'NM Raid', title: 'Nightmare Mode raid' },
    { key: 'easyHardRaidCompleted', label: 'Easy/Hard Raid', title: 'Easy / Hard raid' },
    { key: 'master', label: 'Master' }
  ];

  function sealDifficultyBoxes(values) {
    values = values || {};
    var group = E('fieldset');
    group.className = 'seal-difficulty';
    group.dataset.sealDifficulty = 'true';
    group.appendChild(E('legend', 'Dungeon difficulty'));
    SEAL_DIFFICULTIES.forEach(function (difficulty) {
      var label = E('label');
      label.className = 'seal-difficulty-option';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'seal-difficulty-' + difficulty.key;
      input.value = difficulty.key;
      input.checked = Boolean(values[difficulty.key]);
      if (difficulty.title) { label.title = difficulty.title; input.setAttribute('aria-label', difficulty.label + ' (' + difficulty.title + ')'); }
      label.appendChild(input);
      label.appendChild(E('span', difficulty.label));
      group.appendChild(label);
    });
    return group;
  }

  /** Render the Master Seal editor into its own section. Stim Vault leads,
   * then the six dungeons; a single Save sits at the bottom. */
  function renderSealEditor(options) {
    options = options || {};
    var host = document.getElementById('seal-ui');
    if (!host) return Promise.resolve(null);
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);

    if (!state.session || !memberToken()) {
      message.textContent = configured()
        ? 'Sign in from My Progress to record your Master Seal and Stim Vault progress.'
        : 'Connect the Apps Script API to record Master Seal progress.';
      return Promise.resolve(null);
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

    if (state.switchingAccount) {
      grid.textContent = 'Switching accountâ€¦';
      return Promise.resolve(null);
    }

    function populate(mine) {
      var season = activeSealDefinition(mine.season);
      if (!season) throw new Error('Public Master Seal definitions are unavailable.');
      grid.replaceChildren();
      // Stim Vault first — a floors value with no Master level, resets biweekly.
      grid.appendChild(sealDifficultyBoxes(mine.difficulty));
      var stim = mine.stimVault || { points: 0, bestMasterLevel: null };
      var stimRow = sealRow('stim-vault', 'Stim Vault', stim, season.maxMasterLevel, season.maxScore,
        { withLevel: false, valueLabel: 'Floors', valueMax: stim.max || 60 });
      if (mine.stimVault && mine.stimVault.nextResetAt) {
        var note = E('p', 'Resets ' + fmtSealDate(mine.stimVault.nextResetAt) + (mine.stimVault.justReset ? ' · just reset for the new fortnight' : ''));
        note.className = 'seal-reset-note';
        stimRow.appendChild(note);
      }
      grid.appendChild(stimRow);
      // Then the six dungeons in order.
      season.dungeons.forEach(function (dungeon) {
        var record = null;
        mine.dungeons.forEach(function (d) { if (d.dungeonId === dungeon.id) record = d; });
        grid.appendChild(sealRow(dungeon.id, dungeon.name, record, season.maxMasterLevel, season.maxScore));
      });
      submit.disabled = false;
      renderSealMetric();
      return mine;
    }

    if (state.mySeal && state.mySealKey === state.accountEpoch + '|' + memberToken() && !options.force) {
      populate(state.mySeal);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      var dungeons = {}, stimVault = null;
      var difficulty = { easy: false, hard: false, nmRaidCompleted: false, easyHardRaidCompleted: false, master: false };
      grid.querySelectorAll('fieldset[data-seal]').forEach(function (group) {
        var key = group.dataset.seal;
        if (key === 'stim-vault') stimVault = readSealRow(group);
        else dungeons[key] = readSealRow(group);
      });
      var difficultyGroup = grid.querySelector('fieldset[data-seal-difficulty="true"]');
      if (difficultyGroup) {
        difficultyGroup.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
          difficulty[box.value] = Boolean(box.checked);
        });
      }
      api('masterSealUpdate', {
        token: memberToken(), memberId: state.member.memberId,
        dungeons: dungeons, stimVault: stimVault, difficulty: difficulty
      }).then(function (result) {
        if (state.mySeal) {
          state.mySeal.dungeons = result.dungeons;
          state.mySeal.totals = result.totals;
          state.mySeal.stimVault = result.stimVault;
          state.mySeal.difficulty = result.difficulty;
        }
        // The Stim Vault floor is the SV floor, so keep the member profile and
        // the SV/Masters boards in step after saving.
        if (state.member && result.stimVault) state.member.svFloor = result.stimVault.points;
        // Do not make the member wait for the follow-up public-board read
        // before the two raid status indicators reflect this confirmed save.
        // The board reload below remains the authoritative reconciliation for
        // every viewer and for a later page refresh.
        if (root.MS_PAGE && root.MS_PAGE.applyMemberDifficulty && result.publicMemberId && result.difficulty) {
          root.MS_PAGE.applyMemberDifficulty(result.publicMemberId, result.difficulty);
        }
        message.className = 'notice';
        message.textContent = result.changed ? 'Master Seal progress saved.' : 'No Master Seal changes.';
        renderSealMetric();
        loadPublicSurfaces(true);
      }).catch(function (failure) {
        message.className = 'notice error';
        message.textContent = friendlyFailure(failure);
      }).finally(function () {
        submit.disabled = false;
      });
    });

    if (options.defer || (state.mySeal && state.mySealKey === state.accountEpoch + '|' + memberToken() && !options.force)) {
      return Promise.resolve(state.mySeal);
    }

    var requestKey = state.accountEpoch + '|' + memberToken();
    if (!sealLoadInFlight || sealLoadKey !== requestKey) {
      sealLoadKey = requestKey;
      sealLoadInFlight = api('myMasterSeal', { token: memberToken() }).finally(function () {
        if (sealLoadKey === requestKey) { sealLoadInFlight = null; sealLoadKey = ''; }
      });
    }
    return sealLoadInFlight.then(function (mine) {
      if (requestKey !== state.accountEpoch + '|' + memberToken() || state.switchingAccount) return null;
      state.mySeal = mine; state.mySealKey = requestKey;
      return populate(mine);
    }).catch(function (failure) {
      if (requestKey !== state.accountEpoch + '|' + memberToken()) return null;
      grid.textContent = '';
      message.className = 'notice error';
      message.textContent = friendlyFailure(failure);
      return null;
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
        String(state.mySeal.totals.totalScore) + ' / ' + String(activeSealDefinition(state.mySeal.season).maxScore);
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

    // ---- GitHub Data Storage (admin only; normal members never see this) ----
    var ghCard = adminCard('GitHub Data Storage', 'Migrate non-private tracker data to the private data repo, verify it, then switch storage mode. In github mode the boxes save to GitHub and the spreadsheet becomes a write-only mirror you refresh with "Sync with Google Spreadsheet". Sheets keeps private account data only.');
    ghCard.id = 'admin-github';
    var ghStatus = E('pre'); ghStatus.className = 'gh-status'; ghStatus.id = 'admin-github-status';
    ghStatus.textContent = 'Loading GitHub storage status…';
    ghCard.appendChild(ghStatus);
    var ghResult = E('p'); ghResult.className = 'notice'; ghResult.id = 'admin-github-result'; ghResult.setAttribute('role', 'status');
    ghCard.appendChild(ghResult);

    function ghShow(status) {
      ghStatus.textContent =
        'Mode:        ' + status.mode + (status.configured ? '' : ' (NOT CONFIGURED)') + '\n' +
        'Data repo:   ' + (status.owner || '?') + '/' + (status.repo || '?') + ' @ ' + (status.branch || '?') + '\n' +
        'Commit:      ' + (status.currentCommit ? String(status.currentCommit).slice(0, 12) : '—') + '\n' +
        'Schema:      v' + status.schemaVersion + '\n' +
        'Token set:   ' + (status.hasToken ? 'yes' : 'no') + '\n' +
        'Last preview:  ' + (status.lastPreview ? status.lastPreview.at + ' (' + status.lastPreview.memberCount + ' members, ' + status.lastPreview.warnings + ' warnings)' : '—') + '\n' +
        'Last execute:  ' + (status.lastExecute ? status.lastExecute.at + ' commit ' + String(status.lastExecute.commit || '').slice(0, 12) + ' (' + status.lastExecute.memberCount + ' members)' : '—') + '\n' +
        'Last verify:   ' + (status.lastVerify ? status.lastVerify.at + ' — ' + (status.lastVerify.pass ? 'PASS' : (status.lastVerify.problems + ' problem(s)')) : '—') + '\n' +
        'Last sheet sync: ' + (status.lastSync ? status.lastSync.at + ' (' + status.lastSync.membersSynced + ' members, ' + status.lastSync.problems + ' problem(s))' : '—');
    }
    function ghLoadStatus() {
      return api('getGithubStorageStatus', { token: token }).then(ghShow).catch(function (f) { ghStatus.textContent = friendlyFailure(f); });
    }
    function ghNotice(msg, isError) { ghResult.className = 'notice' + (isError ? ' error' : ''); ghResult.textContent = msg; }
    // Survive a re-render: if a preview token is already held, say so.
    if (state.ghConfirm) ghNotice('Preview ready — you may Execute migration.');

    ghCard.appendChild(actionButton('Refresh status', 'admin', function () { return ghLoadStatus(); }));
    ghCard.appendChild(actionButton('1. Preview migration', 'admin', function () {
      return api('previewGithubMigration', { token: token }).then(function (r) {
        state.ghConfirm = r.confirmToken;
        ghNotice('Preview: ' + r.memberCount + ' members, ' + r.warnings.length + ' warning(s). ' +
          (r.warnings.length ? 'Resolve: ' + r.warnings.slice(0, 3).join('; ') : 'No warnings — you may execute.') +
          ' (' + r.raidConversionNote + ')', r.warnings.length > 0);
        return ghLoadStatus();   // reflect the new Last preview immediately
      });
    }));
    ghCard.appendChild(actionButton('2. Execute migration', 'admin', function () {
      if (!state.ghConfirm) { ghNotice('Run a preview first.', true); return; }
      if (!root.confirm('Write the full initial dataset to GitHub in one commit? Spreadsheet data is left untouched.')) return;
      var confirmToken = state.ghConfirm;
      state.ghConfirm = null;   // single-use: consume before the call so a double-click cannot resend it
      return api('executeGithubMigration', { token: token, confirmToken: confirmToken }).then(function (r) {
        ghNotice('Migrated ' + r.memberCount + ' members. Commit ' + String(r.commit).slice(0, 12) + '. Now Verify.');
        return ghLoadStatus();
      }).catch(function (f) {
        // A failed execute (e.g. source changed) means the token is spent; a
        // fresh Preview is required. Surface it and refresh status.
        ghNotice(friendlyFailure(f), true);
        return ghLoadStatus();
      });
    }));
    ghCard.appendChild(actionButton('3. Verify migration', 'admin', function () {
      return api('verifyGithubMigration', { token: token }).then(function (r) {
        ghNotice(r.pass ? 'Verification PASSED (' + r.memberCount + ' members). github mode may be enabled.'
          : 'Verification FAILED: ' + r.problems.slice(0, 4).join('; '), !r.pass);
        return ghLoadStatus();
      });
    }));
    ghCard.appendChild(actionButton('Enable shadow mode', 'admin', function () {
      return api('switchGithubStorageMode', { token: token, mode: 'shadow' }).then(function (r) { ghNotice('Storage mode is now: ' + r.mode); return ghLoadStatus(); });
    }));
    ghCard.appendChild(actionButton('Enable github mode', 'admin', function () {
      if (!root.confirm('Switch live storage to GitHub? Verification must have passed. Sheets will no longer serve normal tracker data.')) return;
      return api('switchGithubStorageMode', { token: token, mode: 'github' }).then(function (r) { ghNotice('Storage mode is now: ' + r.mode); return ghLoadStatus(); });
    }));
    ghCard.appendChild(actionButton('Return to sheets mode', 'admin', function () {
      return api('switchGithubStorageMode', { token: token, mode: 'sheets' }).then(function (r) { ghNotice('Storage mode is now: ' + r.mode); return ghLoadStatus(); });
    }));
    ghCard.appendChild(actionButton('Sync with Google Spreadsheet', 'admin', function () {
      if (!root.confirm('Copy the current GitHub data into the Google Spreadsheet? This overwrites the sheet mirror (including the NM Raid and Easy/Hard Raid columns); GitHub stays the source of truth.')) return;
      return api('syncGithubToSheets', { token: token }).then(function (r) {
        ghNotice('Synced ' + r.membersSynced + ' member(s) into the spreadsheet' +
          (r.skippedNoFile ? ', ' + r.skippedNoFile + ' with no GitHub file skipped' : '') +
          (r.problems && r.problems.length ? '. Problems: ' + r.problems.slice(0, 3).join('; ') : '.'),
          Boolean(r.problems && r.problems.length));
        return ghLoadStatus();
      });
    }));
    adminGrid.appendChild(ghCard);
    ghLoadStatus();
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
        state.accounts = result.accounts || null;
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
    cookiePath: cookiePath,
    loadSurfaces: loadRequiredSurfaces
  };
  root.BPSR_ACCOUNTS = {
    open: showAccountChooser,
    switchTo: switchActiveAccount,
    refresh: refreshAccessibleAccounts,
    available: function () { return Boolean(state.session && state.member && !state.switchingAccount); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var preview = document.getElementById('preview-notice');
    if (preview) preview.hidden = configured();
    clearDemoPreview();
    boot().then(function () { return loadRequiredSurfaces(false); });
  });
}(window));
