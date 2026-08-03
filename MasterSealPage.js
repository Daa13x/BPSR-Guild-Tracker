/* Master Seal — Season 3 dashboard controller.
 * Data-driven from the masterSeal API action; every score, percentage and
 * milestone state is derived from the season configuration the server sends.
 * Pure helpers are exported on window.MS_HELPERS for tests. */
(function (root) {
  'use strict';

  var ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;   // "recently active" indicator
  var STALE_DAYS = 14;
  var DEFAULT_PAGE_SIZE = 10;

  var state = {
    season: null,
    viewerName: null,
    manualSelect: false,
    members: [],
    selected: null,
    query: '',
    sort: 'rank',
    filter: 'all',
    advStale: false,
    advZero: false,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    status: 'loading'
  };

  // ---------------------------------------------------------------------
  // Pure helpers (unit-tested)
  // ---------------------------------------------------------------------

  function remainingScore(totalScore, maxScore) {
    return Math.max(0, (Number(maxScore) || 0) - (Number(totalScore) || 0));
  }

  function progressPercent(totalScore, maxScore) {
    var max = Number(maxScore) || 0;
    if (max <= 0) return 0;
    return Math.min(100, (Number(totalScore) || 0) / max * 100);
  }

  function clearedCount(dungeons) {
    if (!dungeons || !dungeons.length) return 0;
    return dungeons.filter(function (d) { return d && d.cleared; }).length;
  }

  function milestoneState(threshold, totalScore, previousThreshold) {
    if ((Number(totalScore) || 0) >= Number(threshold)) return 'done';
    var previous = previousThreshold === undefined || previousThreshold === null ? 0 : Number(previousThreshold);
    return (Number(totalScore) || 0) >= previous ? 'next' : 'locked';
  }

  function markerOffset(threshold, maxScore) {
    var max = Number(maxScore) || 0;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, Number(threshold) / max * 100));
  }

  function recentlyActive(lastUpdated, now) {
    if (!lastUpdated) return false;
    var at = new Date(lastUpdated).getTime();
    if (!isFinite(at)) return false;
    return (now || Date.now()) - at <= ACTIVE_WINDOW_MS;
  }

  function isStale(lastUpdated, now) {
    if (!lastUpdated) return true;
    var at = new Date(lastUpdated).getTime();
    if (!isFinite(at)) return true;
    return ((now || Date.now()) - at) / 86400000 > STALE_DAYS;
  }

  /** Search + filter + sort, in that order. Returns a new array. */
  function selectMembers(members, options) {
    var o = options || {};
    var now = o.now || Date.now();
    var query = String(o.query || '').trim().toLowerCase();
    var list = (members || []).filter(function (m) {
      if (query && String(m.name).toLowerCase().indexOf(query) === -1) return false;
      var active = recentlyActive(m.lastUpdated, now);
      switch (o.filter) {
        case 'tank': if (!hasCombatRole(m, 'tank')) return false; break;
        case 'healer': if (!hasCombatRole(m, 'healer')) return false; break;
        case 'dps': if (!hasCombatRole(m, 'dps')) return false; break;
        case 'online': if (!active) return false; break;
        case 'offline': if (active) return false; break;
        case 'mount': if (!m.mountUnlocked) return false; break;
        case 'locked': if (m.mountUnlocked) return false; break;
        case 'six': if (m.clearedCount !== 6) return false; break;
        case 'incomplete': if (m.clearedCount === 6) return false; break;
      }
      if (o.advStale && !isStale(m.lastUpdated, now)) return false;
      if (o.advZero && Number(m.totalScore) > 0) return false;
      return true;
    });
    var sorters = {
      rank: function (a, b) { return a.rank - b.rank; },
      total: function (a, b) { return b.totalScore - a.totalScore || a.rank - b.rank; },
      progress: function (a, b) { return b.progressPercent - a.progressPercent || a.rank - b.rank; },
      remaining: function (a, b) { return a.remainingScore - b.remainingScore || a.rank - b.rank; },
      updated: function (a, b) { return String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')) || a.rank - b.rank; },
      sv: function (a, b) {
        var af = a.svFloor === null ? -1 : a.svFloor;
        var bf = b.svFloor === null ? -1 : b.svFloor;
        return (bf - af) || a.rank - b.rank;
      },
      name: function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; }
    };
    return list.sort(sorters[o.sort] || sorters.rank);
  }

  function hasCombatRole(member, role) {
    return (member.classes || []).some(function (entry) {
      var c = root.BPSR_CLASSES && root.BPSR_CLASSES.getClass(entry.classId);
      return c && c.combatRole === role;
    });
  }

  function classSymbols(member) {
    return (member.classes || []).map(function (entry) {
      var c = root.BPSR_CLASSES && root.BPSR_CLASSES.getClass(entry.classId);
      if (!c) return '';
      return '<span class="ms-class-symbol" title="' + esc(c.name + ' · ' + entry.buildId) + '" aria-label="' + esc(c.name + ' · ' + entry.buildId) + '" style="--cls-colour:' + esc(root.BPSR_CLASSES.colourHex(c.id)) + ';--cls-icon:url(\'' + esc(root.BPSR_CLASSES.iconPath(c.id)) + '\')"></span>';
    }).join('');
  }

  function classConfig(member) {
    var order = ['dps', 'tank', 'healer'], groups = { dps: [], tank: [], healer: [] };
    (member.classes || []).forEach(function (entry) {
      var c = root.BPSR_CLASSES && root.BPSR_CLASSES.getClass(entry.classId);
      var valid = c && root.BPSR_CLASSES.validate(entry.classId, entry.buildId);
      if (c && valid.ok && groups[c.combatRole]) groups[c.combatRole].push({ c: c, build: valid.build });
    });
    var html = order.map(function (role) {
      if (!groups[role].length) return '';
      var label = groups[role][0].c.roleLabel;
      var details = groups[role].map(function (item) { return item.c.name + ' · ' + item.build.name; }).join('\n');
      return '<span class="ms-config-role ' + esc(groups[role][0].c.roleColor) + '" tabindex="0" title="' + esc(details) + '" aria-label="' + esc(label + ': ' + details.replace(/\n/g, ', ')) + '">' + esc(label) + '</span>';
    }).join('');
    return html || '<span class="dim">—</span>';
  }

  function pageSlice(list, page, size) {
    var total = Math.max(1, Math.ceil(list.length / size));
    var current = Math.min(Math.max(1, page), total);
    var start = (current - 1) * size;
    return { rows: list.slice(start, start + size), page: current, pages: total, start: start };
  }

  /** Season timing: the end date has not been announced, so the tracker
   * reports the published schedule rather than counting down to a guess. */
  function seasonSchedule(season) {
    var note = (root.BPSR_SEASON || {});
    var through = (season && season.scheduleThrough) || note.scheduleThrough || '';
    var announced = Boolean(season && season.endDateAnnounced);
    return {
      announced: announced,
      headline: announced && season.endsAt
        ? 'Ends ' + fmtDate(season.endsAt)
        : (note.shortNote || 'End date not announced'),
      detail: through
        ? 'Published schedule runs through ' + through + '.'
        : 'No published schedule is configured.'
    };
  }

  root.MS_HELPERS = {
    remainingScore: remainingScore,
    progressPercent: progressPercent,
    clearedCount: clearedCount,
    milestoneState: milestoneState,
    markerOffset: markerOffset,
    recentlyActive: recentlyActive,
    isStale: isStale,
    selectMembers: selectMembers,
    classConfig: classConfig,
    pageSlice: pageSlice,
    seasonSchedule: seasonSchedule
  };

  if (typeof document === 'undefined') return;   // helper-only import (tests)

  // ---------------------------------------------------------------------
  // Formatting and DOM helpers
  // ---------------------------------------------------------------------

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function pad2(n) { return ('0' + String(n)).slice(-2); }
  function byId(id) { return document.getElementById(id); }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  }

  function slugName(name) {
    return String(name).toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function dungeonImage(d) {
    return 'assets/master-seal/dungeons/dungeon-' + pad2(d.number) + '-' + slugName(d.name) + '.webp';
  }
  var REWARD_IMAGES = { currency: 'reward-rose-orb.webp', frame: 'reward-avatar-frame.webp', namecard: 'reward-namecard.webp', mount: 'reward-mount-neon-sonic.webp' };
  function rewardImage(r) { return 'assets/master-seal/rewards/' + (REWARD_IMAGES[r.rewardType] || REWARD_IMAGES.currency); }

  /** Deterministic themed gradient fallback when dungeon art is missing. */
  var DUNGEON_THEMES = [
    'linear-gradient(160deg,#7f1d1d,#f97316 55%,#1c0a08)',
    'linear-gradient(160deg,#831843,#f0abfc 55%,#1a0716)',
    'linear-gradient(160deg,#1e3a8a,#fbbf24 60%,#0b1020)',
    'linear-gradient(160deg,#7c2d12,#fb923c 55%,#160a05)',
    'linear-gradient(160deg,#134e4a,#22d3ee 55%,#04161a)',
    'linear-gradient(160deg,#4c1d95,#a78bfa 55%,#0d0620)'
  ];

  function setConnection(kind, text) {
    var dot = byId('ms-conn-dot'), label = byId('ms-conn-status');
    if (dot) dot.className = 'ms-dot' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '');
    if (label) label.textContent = text;
  }

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------

  function api(action, data) {
    var config = root.BPSR_CONFIG;
    if (!config || !config.isConfigured || !config.isConfigured()) {
      return Promise.reject(Object.assign(new Error('The API is not configured yet.'), { code: 'CONFIGURATION' }));
    }
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, config.timeoutMs || 45000);
    return root.fetch(config.apiUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: data || {} }),
      signal: controller.signal
    }).then(function (r) { return r.text(); }).then(function (text) {
      var envelope;
      try { envelope = JSON.parse(text); } catch (_) { throw new Error('The API returned an invalid response.'); }
      if (!envelope.ok) {
        var failure = new Error((envelope.error && envelope.error.message) || 'Request could not be completed.');
        failure.code = envelope.error && envelope.error.code;
        throw failure;
      }
      return envelope.data;
    }).finally(function () { root.clearTimeout(timer); });
  }

  /** Adapter: backend board rows -> the UI member model. */
  function adaptMember(row, season, index) {
    var dungeons = (season.dungeons || []).map(function (def, i) {
      var result = (row.dungeons || [])[i] || {};
      return {
        dungeonId: def.id, dungeonName: def.name, shortName: def.shortName, number: def.number,
        bestMasterLevel: result.bestMasterLevel === undefined ? null : result.bestMasterLevel,
        points: Number(result.points) || 0,
        cleared: Boolean(result.cleared)
      };
    });
    // Server totals stay authoritative; derived values are used only when absent.
    var total = Number(row.totalScore) || 0;
    return {
      id: row.name, name: String(row.name), rank: Number(row.rank) || index + 1,
      totalScore: total,
      remainingScore: row.remainingScore === undefined ? remainingScore(total, season.maxScore) : Number(row.remainingScore),
      progressPercent: row.progressPercent === undefined ? progressPercent(total, season.maxScore) : Number(row.progressPercent),
      clearedCount: row.clearedCount === undefined ? clearedCount(dungeons) : Number(row.clearedCount),
      mountUnlocked: Boolean(row.mountUnlocked),
      lastUpdated: row.lastUpdated || null,
      verified: Boolean(row.verified),
      hidden: Boolean(row.hidden),
      classes: Array.isArray(row.classes) ? row.classes.map(function (entry) { return { classId: String(entry.classId || ''), buildId: String(entry.buildId || entry.buildPathId || '') }; }) : [],
      svFloor: normaliseSvFloor(row.svFloor === undefined ? row.SVFloor : row.svFloor),
      dungeons: dungeons
    };
  }

  function normaliseSvFloor(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    var floor = Number(value);
    return isFinite(floor) && Math.floor(floor) === floor && floor >= 0 && floor <= 60 ? floor : null;
  }

  /** Verified mark shown beside a verified member's character name. */
  function verifiedMark() {
    return '<span class="verified" title="Verified by a guild administrator" aria-label="Verified">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M12 1.6l2.5 2.1 3.3-.3.9 3.2 2.9 1.7-1.1 3.1 1.1 3.1-2.9 1.7-.9 3.2-3.3-.3L12 22.4l-2.5-2.1-3.3.3-.9-3.2L2.4 15.7 3.5 12.6 2.4 9.5l2.9-1.7.9-3.2 3.3.3L12 1.6z"/>' +
      '<path fill="#0b0712" d="M10.6 15.2l-2.8-2.8 1.2-1.2 1.6 1.6 3.6-3.6 1.2 1.2z"/></svg></span>';
  }

  // ---------------------------------------------------------------------
  // Rendering — table
  // ---------------------------------------------------------------------

  function renderTable() {
    var host = byId('ms-table-host');
    var showing = byId('ms-showing');
    var pages = byId('ms-pages');
    var badge = byId('ms-count-badge');
    if (!host) return;

    if (state.status === 'error') {
      var failure = state.failure || {};
      host.innerHTML = '<div class="ms-empty is-error"><strong>' + esc(failure.title || 'Guild data could not be loaded') +
        '</strong><p>' + esc(failure.detail || '') + '</p></div>';
      showing.textContent = '';
      pages.replaceChildren();
      return;
    }
    if (!state.members.length) {
      host.innerHTML = '<div class="ms-empty"><strong>No guild members yet</strong>' +
        '<p>Members appear here once they create an account and record Master Seal progress.</p>' +
        '<a class="ms-reset" href="Leaderboard.html#my-progress">Open member management</a></div>';
      showing.textContent = 'No members';
      pages.replaceChildren();
      if (badge) badge.textContent = '0 Members';
      return;
    }

    var filtered = selectMembers(state.members, state);
    var slice = pageSlice(filtered, state.page, state.pageSize);
    state.page = slice.page;

    if (badge) badge.textContent = filtered.length + ' / ' + state.members.length + ' Members';

    if (!filtered.length) {
      host.innerHTML = '<div class="ms-empty"><strong>No members match</strong>' +
        '<p>No members match the current search and filters.</p>' +
        '<button class="ms-reset" type="button" data-reset>Reset filters</button></div>';
      showing.textContent = 'Showing 0 of ' + state.members.length + ' members';
      pages.replaceChildren();
      var resetBtn = host.querySelector('[data-reset]');
      if (resetBtn) resetBtn.addEventListener('click', resetFilters);
      return;
    }

    var season = state.season;
    var now = Date.now();
    var html = '<table class="ms-table"><thead>' +
      '<tr><th colspan="10"></th><th colspan="6" class="ms-group-head">Chaotic Realm Dungeons<small>(best Master clear)</small></th></tr>' +
      '<tr>' +
      '<th scope="col">Rank</th><th scope="col">Character</th><th scope="col">Config</th><th scope="col">Total Score</th>' +
      '<th scope="col">Progress</th><th scope="col">Remaining</th><th scope="col">Cleared</th>' +
      '<th scope="col">Mount</th><th scope="col">Last Updated</th><th scope="col">SV Floor</th>' +
      season.dungeons.map(function (d) {
        return '<th scope="col" class="ms-dh" title="' + esc(d.name) + '">' +
          '<span class="ms-dh-num">' + d.number + '</span>' +
          '<span class="ms-dh-name">' + esc(d.shortName || d.name) + '</span></th>';
      }).join('') +
      '</tr></thead><tbody>';

    slice.rows.forEach(function (m) {
      var selected = state.selected === m.id;
      var active = recentlyActive(m.lastUpdated, now);
      var pct = Math.round(m.progressPercent);
      html += '<tr tabindex="0" role="button" data-member="' + esc(m.id) + '" aria-pressed="' + selected + '"' +
        (selected ? ' class="selected"' : '') + '>' +
        '<td data-l="Rank"><span class="ms-rank' + (m.rank <= 3 ? ' r' + m.rank : '') + '">' + m.rank + '</span></td>' +
        '<td data-l="Character"><span class="ms-char">' +
          '<span class="ms-avatar" aria-hidden="true">' + esc(m.name.charAt(0).toUpperCase()) +
            '<span class="ms-status' + (active ? ' on' : '') + '"></span></span>' +
          '<span class="ms-char-name">' + esc(m.name) + '</span>' + (m.verified ? verifiedMark() : '') +
          '<span class="ms-class-symbols">' + classSymbols(m) + '</span>' +
          (m.hidden ? '<span class="badge hidden-badge" title="Hidden from other viewers — only you can see this row">Hidden — only you</span>' : '') +
          '<span class="sr-only">' + (active ? 'Active in the last 24 hours' : 'Not active recently') + '</span>' +
        '</span></td>' +
        '<td data-l="Config" class="ms-config">' + classConfig(m) + '</td>' +
        '<td data-l="Total"><span class="ms-total">' + num(m.totalScore) + '<small>/ ' + num(season.maxScore) + '</small></span></td>' +
        '<td data-l="Progress"><span class="ms-pct">' + pct + '%</span>' +
          '<span class="ms-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
          '<i style="width:' + pct + '%"></i></span></td>' +
        '<td data-l="Remaining"><span class="ms-remaining">' + num(m.remainingScore) + '</span></td>' +
        '<td data-l="Cleared"><span class="ms-cleared' + (m.clearedCount === 6 ? ' full' : '') + '">' + m.clearedCount + ' / 6</span></td>' +
        '<td data-l="Mount">' + (m.mountUnlocked
          ? '<span class="ms-mount on"><img src="' + rewardImage({ rewardType: 'mount' }) + '" alt="" loading="lazy" onerror="this.remove()">Unlocked</span>'
          : '<span class="ms-mount">🔒 Locked</span>') + '</td>' +
        '<td data-l="Updated"><span class="ms-updated">' + fmtDate(m.lastUpdated) + '<small>' + fmtTime(m.lastUpdated) + '</small></span></td>' +
        '<td data-l="SV Floor"><span class="ms-svfloor' + (m.svFloor >= 60 ? ' full' : '') + '">' +
          (m.svFloor === null ? '—<small> unavailable</small>' : m.svFloor + '<small>/ 60</small>') + '</span></td>' +
        m.dungeons.map(function (d) {
          return '<td class="ms-dcell' + (d.cleared ? '' : ' un') + '" data-l="' + esc(d.shortName || d.dungeonName) + '">' +
            '<span class="sr-only">' + esc(d.dungeonName) + ': ' + (d.cleared
              ? 'Master level ' + (d.bestMasterLevel === null ? 'unknown' : d.bestMasterLevel) + ', ' + num(d.points) + ' points'
              : 'not cleared') + '</span>' +
            '<span class="ms-dchip" aria-hidden="true" data-tip="' + esc(d.dungeonName) + (d.cleared && d.bestMasterLevel !== null ? ' — best Master level ' + d.bestMasterLevel : ' — not cleared') + '">' +
            '<b>' + (d.cleared && d.bestMasterLevel !== null ? 'M' + d.bestMasterLevel : '—') + '</b>' +
            '<span>' + num(d.points) + '</span></span></td>';
        }).join('') +
        '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;

    var first = slice.start + 1;
    var last = slice.start + slice.rows.length;
    showing.textContent = 'Showing ' + first + ' to ' + last + ' of ' + filtered.length + ' members';
    renderPagination(slice.page, slice.pages);
    wireRows();
  }

  function renderPagination(page, total) {
    var host = byId('ms-pages');
    if (!host) return;
    host.replaceChildren();
    function pageButton(label, target, disabled, current) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ms-page';
      button.textContent = label;
      if (disabled) button.disabled = true;
      if (current) button.setAttribute('aria-current', 'page');
      button.setAttribute('aria-label', typeof target === 'number' ? 'Page ' + target : label);
      button.addEventListener('click', function () {
        state.page = target;
        renderTable();
        var wrap = byId('ms-tablewrap');
        if (wrap) wrap.scrollTop = 0;
      });
      host.appendChild(button);
    }
    pageButton('‹', Math.max(1, page - 1), page === 1, false);
    var start = Math.max(1, Math.min(page - 1, total - 2));
    var end = Math.min(total, start + 2);
    if (start > 1) pageButton('1', 1, false, page === 1);
    if (start > 2) host.appendChild(Object.assign(document.createElement('span'), { textContent: '…', className: 'ms-showing' }));
    for (var p = start; p <= end; p++) pageButton(String(p), p, false, p === page);
    if (end < total - 1) host.appendChild(Object.assign(document.createElement('span'), { textContent: '…', className: 'ms-showing' }));
    if (end < total) pageButton(String(total), total, false, page === total);
    pageButton('›', Math.min(total, page + 1), page === total, false);
  }

  function wireRows() {
    document.querySelectorAll('#ms-table-host tr[data-member]').forEach(function (row) {
      row.addEventListener('click', function () { select(row.dataset.member); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(row.dataset.member); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        var sibling = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
        if (sibling && sibling.dataset.member) { select(sibling.dataset.member); sibling.focus(); }
      });
    });
    document.querySelectorAll('#ms-table-host [data-tip]').forEach(function (node) {
      node.addEventListener('mouseenter', function (event) { showTip(node.dataset.tip, event); });
      node.addEventListener('mouseleave', hideTip);
    });
  }

  function showTip(text, event) {
    var tip = byId('ms-tooltip');
    if (!tip || !text) return;
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = Math.min(root.innerWidth - 240, event.clientX + 12) + 'px';
    tip.style.top = Math.max(8, event.clientY - 40) + 'px';
  }
  function hideTip() { var tip = byId('ms-tooltip'); if (tip) tip.hidden = true; }

  // ---------------------------------------------------------------------
  // Rendering — detail column
  // ---------------------------------------------------------------------

  function renderDetail() {
    var host = byId('ms-detail');
    if (!host) return;
    if (state.status === 'error') {
      // Keep the shell intact and explain the real cause rather than alarming.
      host.innerHTML = '<section><div class="ms-empty"><strong>Member details will appear here</strong>' +
        '<p>' + esc((state.failure && state.failure.detail) ||
          'They are unavailable while the guild data cannot be loaded.') +
        '</p></div></section>';
      return;
    }
    var member = null;
    state.members.forEach(function (m) { if (m.id === state.selected) member = m; });
    if (!member) {
      host.innerHTML = '<section><div class="ms-empty"><strong>No member selected</strong>' +
        '<p>Select a member in the leaderboard to inspect their Master Seal progress.</p></div></section>';
      return;
    }

    var season = state.season;
    var pct = Math.round(member.progressPercent);
    var active = recentlyActive(member.lastUpdated);

    var html = '<section class="ms-profile">' +
      '<div class="ms-profile-top">' +
        '<span class="ms-avatar lg" aria-hidden="true">' + esc(member.name.charAt(0).toUpperCase()) +
          '<span class="ms-status' + (active ? ' on' : '') + '"></span></span>' +
        '<div class="ms-profile-id"><h2>' + esc(member.name) + '</h2>' +
          '<p>Rank ' + member.rank + ' · ' + esc(season.displayName) + ' Master Seal · ' +
          (active ? 'active recently' : 'not active recently') + '</p></div>' +
        '<div class="ms-profile-score"><span>Total score</span>' +
          '<strong>' + num(member.totalScore) + '<em> / ' + num(season.maxScore) + '</em></strong></div>' +
      '</div>' +
      '<div class="ms-profile-bar">' +
        '<span class="track" role="progressbar" aria-label="Season progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
        '<i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></div>' +
      '<p class="ms-profile-caption">Progress to ' + num(season.maxScore) + '</p>' +
      '<div class="ms-metrics">' +
        '<div class="ms-metric accent"><span>Remaining</span><strong>' + num(member.remainingScore) + '</strong></div>' +
        '<div class="ms-metric' + (member.clearedCount === 6 ? ' ok' : '') + '"><span>Cleared</span><strong>' + member.clearedCount + ' / 6</strong></div>' +
        '<div class="ms-metric' + (member.mountUnlocked ? ' gold' : '') + '"><span>Mount status</span>' +
          '<strong class="ms-metric-lock">' + (member.mountUnlocked ? '★ Unlocked' : '🔒 Locked') + '</strong></div>' +
        '<div class="ms-metric"><span>Last updated</span><strong>' + fmtDate(member.lastUpdated) + '</strong>' +
          '<small>' + fmtTime(member.lastUpdated) + '</small></div>' +
      '</div></section>';

    html += '<section><h3>Chaotic Realm Dungeons <small>(best Master clear)</small></h3><div class="ms-dungeon-grid">';
    member.dungeons.forEach(function (d, i) {
      var def = season.dungeons[i];
      html += '<article class="ms-dcard' + (d.cleared ? '' : ' un') + '">' +
        '<div class="ms-dcard-art" style="background:' + DUNGEON_THEMES[i % DUNGEON_THEMES.length] + '">' +
          '<img src="' + dungeonImage(def) + '" alt="' + esc(def.name) + ' artwork" loading="lazy" onerror="this.remove()">' +
          '<span class="ms-dcard-no">' + def.number + '</span>' +
          '<p class="ms-dcard-name">' + esc(def.name) + '</p>' +
        '</div>' +
        '<div class="ms-dcard-body">' +
          '<span class="ms-dcard-level">' + (d.cleared
            ? (d.bestMasterLevel !== null ? 'Master M' + d.bestMasterLevel : 'Cleared')
            : 'Not cleared') + '</span>' +
          '<span class="ms-dcard-pts">' + num(d.points) + ' pts</span>' +
        '</div></article>';
    });
    html += '</div></section>';

    // Rewards are spaced evenly across the full width (rather than by absolute
    // score) so there is no empty gap before the first milestone. The fill
    // interpolates between the evenly-spaced marks for the member's total.
    var rewardCount = season.rewards.length;
    var evenPos = function (i) { return rewardCount <= 1 ? 0 : (i / (rewardCount - 1)) * 100; };
    var fillPct = 0;
    var ts = member.totalScore;
    if (ts >= season.rewards[rewardCount - 1].score) {
      fillPct = 100;
    } else {
      for (var fi = 0; fi < rewardCount - 1; fi++) {
        var lo = fi === 0 ? 0 : season.rewards[fi].score;
        var hi = season.rewards[fi + 1].score;
        if (ts < hi) {
          var base = fi === 0 ? 0 : evenPos(fi);
          var span = evenPos(fi + 1) - base;
          var frac = hi > lo ? Math.max(0, (ts - lo) / (hi - lo)) : 0;
          fillPct = base + frac * span;
          break;
        }
      }
    }
    html += '<section><div class="ms-rewards-head"><h3>' + esc(season.displayName) + ' Rewards</h3>' +
      '<span class="ms-rewards-max">Max score <b>' + num(season.maxScore) + '</b></span></div>' +
      '<div class="ms-track">' +
      '<span class="ms-track-rail" aria-hidden="true"></span>' +
      '<span class="ms-track-fill" aria-hidden="true" style="width:' + Math.min(100, fillPct) + '%"></span>' +
      '<div class="ms-track-marks">';
    season.rewards.forEach(function (reward, i) {
      var previous = i === 0 ? 0 : season.rewards[i - 1].score;
      var status = milestoneState(reward.score, member.totalScore, previous);
      var offset = evenPos(i);
      var isFinal = i === season.rewards.length - 1;
      html += '<div class="ms-mark ' + status + (isFinal ? ' final' : '') + '" style="left:' + offset + '%">' +
        '<span class="ms-mark-score">' + num(reward.score) + '</span>' +
        '<span class="ms-mark-art"><img src="' + rewardImage(reward) + '" alt="" loading="lazy" onerror="this.remove()"></span>' +
        '<span class="ms-mark-node" aria-hidden="true">✓</span>' +
        '<span class="ms-mark-name">' + esc(reward.rewardName) + '</span>' +
        '<span class="sr-only">' + esc(reward.rewardName) + ' at ' + num(reward.score) + ' points: ' +
          (status === 'done' ? 'earned' : status === 'next' ? 'next milestone' : 'locked') + '</span>' +
        '</div>';
    });
    html += '</div></div>' +
      '<p class="ms-rewards-note"><button class="ms-info" type="button" id="ms-rewards-info" aria-label="How Master Seal points are earned">i</button>' +
      'Earn points by achieving your best Master Seal clear in each dungeon every week.</p></section>';

    host.innerHTML = html;
    var info = byId('ms-rewards-info');
    if (info) {
      info.addEventListener('click', function (event) {
        showTip('Each dungeon contributes its best Master clear score. Totals update when a member records new progress.', event);
        root.setTimeout(hideTip, 6000);
      });
    }
  }

  // ---------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------

  function select(id) {
    state.selected = id;
    state.manualSelect = true;   // a deliberate choice sticks over the viewer default
    renderTable();
    renderDetail();
  }

  function ensureSelection() {
    var visible = selectMembers(state.members, state);
    // Until the viewer manually picks another member, keep the detail panel on
    // their own row — even after the board reloads and their row appears late.
    if (state.viewerName && !state.manualSelect) {
      var own = null;
      visible.forEach(function (m) { if (m.name === state.viewerName) own = m.id; });
      if (own) { state.selected = own; return; }
    }
    if (state.selected && visible.some(function (m) { return m.id === state.selected; })) return;
    var preferred = null;
    // Default to the signed-in member's own row when it is on the board.
    if (state.viewerName) visible.forEach(function (m) { if (m.name === state.viewerName) preferred = m.id; });
    if (!preferred) {
      try {
        var stored = root.localStorage.getItem('bpsr.member.display');
        if (stored) visible.forEach(function (m) { if (m.name === stored) preferred = m.id; });
      } catch (_) { /* storage optional */ }
    }
    state.selected = preferred || (visible.length ? visible[0].id : null);
  }

  function refreshView() {
    ensureSelection();
    renderTable();
    renderDetail();
  }

  function resetFilters() {
    state.query = ''; state.filter = 'all'; state.sort = 'rank';
    state.advStale = false; state.advZero = false; state.page = 1;
    var search = byId('ms-search'); if (search) search.value = '';
    var filter = byId('ms-filter'); if (filter) filter.value = 'all';
    var sort = byId('ms-sort'); if (sort) sort.value = 'rank';
    var stale = byId('ms-adv-stale'); if (stale) stale.checked = false;
    var zero = byId('ms-adv-zero'); if (zero) zero.checked = false;
    refreshView();
  }

  var searchTimer = null;
  function wireControls() {
    var search = byId('ms-search');
    if (search) {
      search.addEventListener('input', function () {
        root.clearTimeout(searchTimer);
        searchTimer = root.setTimeout(function () {
          state.query = search.value; state.page = 1; refreshView();
        }, 140);
      });
    }
    var sort = byId('ms-sort');
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; state.page = 1; refreshView(); });
    var filter = byId('ms-filter');
    if (filter) filter.addEventListener('change', function () { state.filter = filter.value; state.page = 1; refreshView(); });
    var advanced = byId('ms-advanced'), panel = byId('ms-advanced-panel');
    if (advanced && panel) {
      advanced.addEventListener('click', function () {
        var open = panel.hidden;
        panel.hidden = !open;
        advanced.setAttribute('aria-expanded', String(open));
      });
    }
    var stale = byId('ms-adv-stale');
    if (stale) stale.addEventListener('change', function () { state.advStale = stale.checked; state.page = 1; refreshView(); });
    var zero = byId('ms-adv-zero');
    if (zero) zero.addEventListener('change', function () { state.advZero = zero.checked; state.page = 1; refreshView(); });
    var size = byId('ms-page-size');
    if (size) size.addEventListener('change', function () { state.pageSize = Number(size.value) || DEFAULT_PAGE_SIZE; state.page = 1; refreshView(); });
    var reset = byId('ms-reset');
    if (reset) reset.addEventListener('click', resetFilters);
    var drawer = byId('ms-drawer-toggle'), sidebar = byId('ms-sidebar');
    if (drawer && sidebar) {
      drawer.addEventListener('click', function () {
        var open = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open', open);
        drawer.setAttribute('aria-expanded', String(open));
      });
    }
  }

  function renderSeasonNote() {
    var value = byId('ms-season-note-value');
    var sub = byId('ms-season-note-sub');
    if (!value && !sub) return;
    var schedule = seasonSchedule(state.season);
    if (value) value.textContent = schedule.headline;
    if (sub) sub.textContent = schedule.detail;
    var statement = byId('ms-season-statement');
    if (statement && root.BPSR_SEASON && root.BPSR_SEASON.statement) {
      statement.textContent = root.BPSR_SEASON.statement;
    }
  }

  function load() {
    setConnection('', 'Connecting…');
    var token = root.BPSR_SESSION ? root.BPSR_SESSION.token() : '';
    return api('masterSeal', token ? { token: token } : {}).then(function (data) {
      state.season = data.season;
      state.members = (data.board || []).map(function (row, i) { return adaptMember(row, data.season, i); });
      state.status = 'ready';
      var maxValue = byId('ms-maxscore-value');
      if (maxValue) maxValue.textContent = num(data.season.maxScore) + ' PTS';
      var tag = byId('ms-season-tag');
      if (tag) tag.textContent = data.season.displayName;
      document.title = data.season.displayName + ' Master Seal · BPSR Guild Tracker';
      setConnection('ok', 'Connected');
      renderSeasonNote();   // show the real season schedule as soon as it arrives
      refreshView();
    }).catch(function (failure) {
      state.status = 'error';
      // Never surface the raw backend string; classify the failure honestly
      // and keep the technical detail in the console.
      var classified = root.BPSR_ERRORS
        ? root.BPSR_ERRORS.classify(failure, 'masterSeal')
        : { status: 'Backend request failed', title: 'Backend request failed', detail: '', kind: 'server' };
      state.failure = classified;
      setConnection('bad', classified.status);
      renderTable();
      renderDetail();
    });
  }

  /** The account controller tells the board who is signed in so the detail
   * panel opens on the viewer's own row by default. Passing null (sign-out)
   * lets the board fall back to the top-ranked member. */
  function setViewer(name) {
    var next = name || null;
    if (next === state.viewerName) return;   // unchanged: don't fight a manual selection
    state.viewerName = next;
    state.manualSelect = false;   // a new sign-in re-defaults to the viewer's own row
    try {
      if (name) root.localStorage.setItem('bpsr.member.display', name);
      else root.localStorage.removeItem('bpsr.member.display');
    } catch (_) { /* storage optional */ }
    state.selected = null;   // force ensureSelection to re-pick the viewer
    if (state.status === 'ready') refreshView();
  }

  root.MS_PAGE = { state: state, load: load, select: select, refreshView: refreshView, resetFilters: resetFilters, setViewer: setViewer };
  // The account controller reloads the board after sign-in / progress saves.
  root.loadMasterSeal = load;

  document.addEventListener('DOMContentLoaded', function () {
    wireControls();
    renderSeasonNote();
    load();
  });
}(typeof window === 'undefined' ? globalThis : window));
