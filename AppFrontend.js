/* Build-free member and administrator controller for the static tracker. */
(function (root) {
  'use strict';

  var CONFIG = root.BPSR_CONFIG || {
    apiUrl: '',
    timeoutMs: 15000,
    isConfigured: function () { return false; }
  };
  var keys = { member: 'bpsr.member.session', admin: 'bpsr.admin.session' };
  var state = {
    member: null,
    admin: null,
    selected: null,
    selectedProfile: null,
    activities: []
  };

  function configured() {
    return CONFIG.isConfigured ? CONFIG.isConfigured() : Boolean(CONFIG.apiUrl);
  }

  function get(kind) {
    try {
      return JSON.parse(root.localStorage.getItem(keys[kind]) || 'null');
    } catch (_) {
      return null;
    }
  }

  function save(kind, session, display) {
    try {
      root.localStorage.setItem(keys[kind], JSON.stringify({
        token: session.token,
        expiresAt: session.expiresAt,
        kind: kind,
        display: display || ''
      }));
    } catch (_) {
      throw Object.assign(new Error('This browser cannot store a session. Allow local storage and try again.'), {
        code: 'STORAGE_UNAVAILABLE'
      });
    }
  }

  function clear(kind) {
    try { root.localStorage.removeItem(keys[kind]); } catch (_) { /* best effort */ }
    state[kind] = null;
    if (kind === 'admin') {
      state.selected = null;
      state.selectedProfile = null;
    }
  }

  function api(action, data) {
    if (!configured()) {
      return Promise.reject(Object.assign(
        new Error('API URL is not configured. Set configuredApiUrl in config.js to the Apps Script /exec URL.'),
        { code: 'CONFIGURATION' }
      ));
    }
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs || 15000);
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

  function syncAdminVisibility(show) {
    var section = document.getElementById('administration');
    var nav = document.querySelector('[data-admin-nav]');
    if (section) section.hidden = !show;
    if (nav) nav.hidden = !show;
  }

  function handleError(kind, failure) {
    if (failure && failure.code === 'SESSION_EXPIRED') {
      clear(kind);
      if (kind === 'member') {
        renderMember();
      } else {
        state.admin = false;
        syncAdminVisibility(Boolean(get('admin') || (state.member && state.member.isAdmin)));
        renderAdmin();
      }
      return;
    }
    notice(kind, failure && failure.message || 'Request could not be completed.', true);
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

  function acceptAdminSession(result) {
    if (result && result.member && result.member.isAdmin && result.adminSession) {
      save('admin', result.adminSession, result.member.characterName);
      state.admin = true;
      syncAdminVisibility(true);
      return;
    }
    if (result && result.member && !result.member.isAdmin) {
      clear('admin');
      state.admin = false;
      syncAdminVisibility(false);
    }
  }

  function authForm(mode) {
    var form = E('form');
    form.className = 'auth-card';
    form.appendChild(E('h3', mode === 'register' ? 'Create member account' : 'Member sign in'));
    var name = field('Character name', 'characterName', 'text', 'Your in-game name');
    var pin = field('PIN', 'pin', 'password', 'At least 6 digits');
    name.input.autocomplete = 'username';
    pin.input.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    pin.input.inputMode = 'numeric';
    form.appendChild(name.wrap);
    form.appendChild(pin.wrap);
    var submit = E('button', mode === 'register' ? 'Register' : 'Sign in');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      api(mode, { characterName: name.input.value, pin: pin.input.value }).then(function (result) {
        save('member', result.session, result.member.characterName);
        state.member = result.member;
        acceptAdminSession(result);
        renderMember();
        if (result.member.isAdmin) renderAdmin();
      }).catch(function (failure) {
        handleError('member', failure);
      }).finally(function () {
        submit.disabled = false;
      });
    });
    return form;
  }

  function renderMember() {
    var host = document.getElementById('member-ui');
    if (!host) return;
    host.replaceChildren();
    var message = E('div');
    message.className = 'notice';
    message.setAttribute('role', 'status');
    host.appendChild(message);
    var session = get('member');

    if (!session) {
      state.member = null;
      syncAdminVisibility(Boolean(get('admin')));
      message.textContent = configured()
        ? 'Register or sign in with your character name and PIN.'
        : 'Set the Apps Script URL in config.js to connect registration and progression.';
      var authGrid = E('div');
      authGrid.className = 'auth-grid';
      authGrid.appendChild(authForm('register'));
      authGrid.appendChild(authForm('login'));
      host.appendChild(authGrid);
      var recovery = E('details');
      recovery.appendChild(E('summary', 'Emergency administrator recovery'));
      recovery.appendChild(actionButton('Open recovery controls', 'member', function () {
        var section = document.getElementById('administration');
        if (section) {
          section.hidden = false;
          renderAdmin();
          section.scrollIntoView({ behavior: 'smooth' });
        }
      }));
      host.appendChild(recovery);
      return;
    }

    var profile = state.member || {};
    syncAdminVisibility(Boolean(profile.isAdmin || get('admin')));
    message.textContent = 'Signed in as ' + (profile.characterName || session.display) +
      '. Totals are calculated by the server.';
    if (profile.isAdmin) {
      var badge = E('span', 'Administrator');
      badge.className = 'pill';
      message.appendChild(badge);
    }

    var metrics = E('div');
    metrics.className = 'metric-grid compact';
    var svMetric = E('div');
    svMetric.className = 'metric-card';
    svMetric.appendChild(E('span', 'SV floor'));
    svMetric.appendChild(E('strong', String(profile.svFloor || 0)));
    var masterMetric = E('div');
    masterMetric.className = 'metric-card';
    masterMetric.appendChild(E('span', 'Master points'));
    masterMetric.appendChild(E('strong', String(profile.masterPoints || 0)));
    metrics.appendChild(svMetric);
    metrics.appendChild(masterMetric);
    host.appendChild(metrics);

    var form = E('form');
    form.className = 'progress-card';
    var sv = field('Highest SV floor (1–60)', 'svFloor', 'number', 'Leave blank if unchanged');
    sv.input.min = '1';
    sv.input.max = '60';
    sv.input.inputMode = 'numeric';
    form.appendChild(sv.wrap);
    var ranks = E('div');
    ranks.className = 'rank-grid';
    form.appendChild(ranks);

    api('activities', {}).then(function (activities) {
      state.activities = activities;
      ranks.replaceChildren();
      activities.forEach(function (activity) {
        var rank = field(
          activity.name + ' rank (0–' + activity.maxRank + ')',
          'rank-' + activity.id,
          'number',
          '0–' + activity.maxRank
        );
        rank.input.min = '0';
        rank.input.max = String(activity.maxRank);
        rank.input.inputMode = 'numeric';
        rank.input.dataset.activity = activity.id;
        rank.input.value = profile.masterRanks && profile.masterRanks[activity.id] || 0;
        ranks.appendChild(rank.wrap);
      });
    }).catch(function (failure) {
      handleError('member', failure);
    });

    var submit = E('button', 'Save progression');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      var masterRanks = {};
      ranks.querySelectorAll('input[data-activity]').forEach(function (rank) {
        masterRanks[rank.dataset.activity] = rank.value;
      });
      api('progress', {
        token: session.token,
        svFloor: sv.input.value || undefined,
        masterRanks: masterRanks
      }).then(function (result) {
        state.member = result.profile;
        renderMember();
        notice('member', result.changed ? 'Progress updated.' : 'No genuine progression change.');
        if (root.load) root.load();
      }).catch(function (failure) {
        handleError('member', failure);
      }).finally(function () {
        submit.disabled = false;
      });
    });
    host.appendChild(form);
    host.appendChild(actionButton('Sign out', 'member', function () {
      return api('logout', { token: session.token, kind: 'member' }).finally(function () {
        clear('member');
        syncAdminVisibility(Boolean(get('admin')));
        renderMember();
      });
    }));
  }

  function selectedDetails(profile) {
    state.selectedProfile = profile;
    var details = document.getElementById('admin-details');
    if (details) {
      details.replaceChildren();
      var rows = [
        ['Character', profile.characterName],
        ['SV floor', profile.svFloor],
        ['Master points', profile.masterPoints],
        ['Role', profile.isAdmin ? 'Administrator' : 'Member'],
        ['Status', profile.disabled ? 'Disabled' : 'Active']
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
    var session = get('admin');

    if (!session) {
      state.admin = false;
      message.textContent = 'Administrator access comes from a member account with the administrator role.';
      var memberSession = get('member');
      if (memberSession && state.member && state.member.isAdmin) {
        host.appendChild(actionButton('Start administrator session', 'admin', function () {
          return api('refresh', { token: memberSession.token, kind: 'member' }).then(function (result) {
            state.member = result.profile;
            acceptAdminSession({ member: result.profile, adminSession: result.adminSession });
            renderAdmin();
          });
        }));
      }
      var recovery = E('details');
      var summary = E('summary', 'Emergency recovery');
      var recoveryForm = E('form');
      var secret = field('Recovery secret', 'secret', 'password', 'BPSR_ADMIN_SECRET');
      secret.input.autocomplete = 'current-password';
      var recover = E('button', 'Use recovery secret');
      recover.type = 'submit';
      recovery.appendChild(summary);
      recoveryForm.appendChild(E('p', 'Use only if no member administrator can sign in.'));
      recoveryForm.appendChild(secret.wrap);
      recoveryForm.appendChild(recover);
      recovery.appendChild(recoveryForm);
      recoveryForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (recover.disabled) return;
        recover.disabled = true;
        api('adminLogin', { secret: secret.input.value }).then(function (result) {
          save('admin', result.session, 'Emergency recovery');
          state.admin = true;
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

    state.admin = true;
    syncAdminVisibility(true);
    message.textContent = 'Administrator session active. Every change is authorized and audited server-side.';
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
      return api('adminMembers', { token: session.token, query: search.input.value }).then(function (members) {
        memberList.replaceChildren();
        members.forEach(function (member) {
          var label = member.characterName + ' — SV ' + member.svFloor +
            (member.isAdmin ? ' — Administrator' : '') + (member.disabled ? ' — Disabled' : '');
          var select = actionButton(label, 'admin', function () {
            state.selected = member.memberId;
            return api('adminRead', { token: session.token, memberId: member.memberId })
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

    var editCard = adminCard('Selected member', 'Edit permitted fields or change account status and role.');
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
        token: session.token,
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
        token: session.token,
        memberId: state.selected,
        isAdmin: desired,
        confirmSelf: self && !desired
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll(desired ? 'Member promoted to administrator.' :
          'Administrator role removed and administrator sessions revoked.');
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
        token: session.token,
        memberId: state.selected,
        disabled: disabled
      }).then(function (profile) {
        selectedDetails(profile);
        return refreshAll(disabled ? 'Member disabled; sessions revoked.' : 'Member enabled.');
      });
    });
    disableButton.id = 'admin-disabled-toggle';
    editCard.appendChild(disableButton);
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
    var mergeWarning = E('p', 'Merging reassigns progression history to the kept member and disables the removed member.');
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
      return api('adminDuplicates', { token: session.token }).then(function (groups) {
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
        token: session.token,
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
    var notes = field('Audit notes', 'notes', 'text', 'Why this correction is needed');
    var correct = E('button', 'Save achievement correction');
    correct.type = 'submit';
    achievementForm.appendChild(achievementId.wrap);
    achievementForm.appendChild(achievementName.wrap);
    achievementForm.appendChild(notes.wrap);
    achievementForm.appendChild(correct);
    toolsCard.appendChild(achievementForm);
    toolsCard.appendChild(actionButton('Start new update period', 'admin', function () {
      if (!root.confirm('Start a new First Guildie period?')) return;
      return api('adminReset', { token: session.token }).then(function () {
        return refreshAll('New update period started.');
      });
    }));
    adminGrid.appendChild(toolsCard);
    achievementForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (correct.disabled) return;
      correct.disabled = true;
      api('adminCorrectAchievement', {
        token: session.token,
        achievementId: achievementId.input.value,
        characterName: achievementName.input.value,
        notes: notes.input.value
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
      return api('adminAudit', { token: session.token }).then(function (rows) {
        audit.replaceChildren();
        rows.forEach(function (entry) {
          audit.appendChild(E('li', (entry.at || '') + ' — ' + entry.action + ' — ' +
            entry.target + ' — ' + entry.details));
        });
        if (!rows.length) audit.appendChild(E('li', 'No audited changes yet.'));
      });
    }

    host.appendChild(actionButton('End administrator session', 'admin', function () {
      return api('logout', { token: session.token, kind: 'admin' }).finally(function () {
        clear('admin');
        state.admin = false;
        syncAdminVisibility(Boolean(state.member && state.member.isAdmin));
        renderAdmin();
      });
    }));

    function refreshAll(successMessage) {
      var jobs = [loadMembers(), loadDuplicates(), loadAudit()];
      if (state.selected) {
        jobs.push(api('adminRead', { token: session.token, memberId: state.selected })
          .then(selectedDetails));
      }
      return Promise.all(jobs).then(function () {
        if (successMessage) notice('admin', successMessage);
        if (root.load) root.load();
      });
    }

    loadMembers().then(loadDuplicates).then(loadAudit).catch(function (failure) {
      handleError('admin', failure);
    });
  }

  function restore(kind) {
    var session = get(kind);
    if (!session || !session.token || new Date(session.expiresAt) <= new Date()) {
      clear(kind);
      if (kind === 'member') renderMember(); else renderAdmin();
      return Promise.resolve(null);
    }
    return api('refresh', { token: session.token, kind: kind }).then(function (result) {
      if (kind === 'member') {
        state.member = result.profile;
        acceptAdminSession({ member: result.profile, adminSession: result.adminSession });
        renderMember();
      } else {
        state.admin = true;
        syncAdminVisibility(true);
        renderAdmin();
      }
      return result;
    }).catch(function () {
      clear(kind);
      if (kind === 'member') renderMember(); else renderAdmin();
      return null;
    });
  }

  function clearDemoPreview() {
    if (configured() || !root.DATA || !root.render) return;
    root.DATA = {
      generatedAt: new Date().toISOString(),
      config: {
        mountTarget: 3650,
        svMax: 60,
        outdatedDays: 14,
        overallEnabled: false,
        feedEnabled: false,
        firstGuildieEnabled: true,
        timezone: 'Europe/London'
      },
      activities: [],
      svBoard: [],
      mpBoard: [],
      mcBoard: [],
      hallOfFame: [],
      firsts: [],
      firstGuildie: { enabled: true, current: null, previous: [] },
      feed: [],
      viewer: null,
      viewerCharacter: ''
    };
    var firsts = document.getElementById('firsts');
    if (firsts) firsts.replaceChildren();
    root.render();
    var stamp = document.getElementById('stamp');
    if (stamp) stamp.textContent = 'Waiting for live guild data — backend not connected.';
  }

  root.BPSR_FRONTEND = {
    api: api,
    renderMember: renderMember,
    renderAdmin: renderAdmin,
    restore: restore,
    state: state,
    clear: clear,
    configured: configured
  };

  document.addEventListener('DOMContentLoaded', function () {
    var preview = document.getElementById('preview-notice');
    if (preview) preview.hidden = configured();
    clearDemoPreview();
    restore('member').then(function () { return restore('admin'); });
  });
}(window));
