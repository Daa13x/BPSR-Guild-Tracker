/* Master Seal — Season 3 public board. Data-driven from the masterSeal API
 * action; every number on screen is calculated by the server. */
(function (root) {
  'use strict';

  var DATA = null;
  var view = { q: '', sort: 'rank', filter: 'all', selected: null };
  var STALE_DAYS = 14;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function pad2(n) { return ('0' + String(n)).slice(-2); }
  function fmtDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }

  function slugName(name) {
    return String(name).toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function dungeonImage(dungeon) {
    return 'assets/master-seal/dungeons/dungeon-' + pad2(dungeon.number) + '-' + slugName(dungeon.name) + '.webp';
  }
  var REWARD_IMAGES = {
    currency: 'reward-rose-orb.webp',
    frame: 'reward-avatar-frame.webp',
    namecard: 'reward-namecard.webp',
    mount: 'reward-mount-neon-sonic.webp'
  };
  function rewardImage(reward) {
    return 'assets/master-seal/rewards/' + (REWARD_IMAGES[reward.rewardType] || REWARD_IMAGES.currency);
  }

  function host() { return document.getElementById('seal-ui'); }

  function loadMasterSeal() {
    var el = host();
    if (!el) return;
    var config = root.BPSR_CONFIG;
    if (!config || !config.isConfigured || !config.isConfigured()) {
      el.innerHTML = '<div class="empty">The Master Seal board connects when the backend API is configured.</div>';
      return;
    }
    if (!DATA) el.innerHTML = '<div class="empty">Loading Master Seal…</div>';
    root.api('masterSeal', {}).then(function (data) {
      DATA = data;
      if (view.selected === null && data.board.length) view.selected = data.board[0].name;
      render();
    }).catch(function (failure) {
      el.innerHTML = '<div class="empty">Master Seal could not load: ' + esc(failure.message || 'API error') + '</div>';
    });
  }

  function rows() {
    var out = DATA.board.filter(function (r) {
      if (view.q && r.name.toLowerCase().indexOf(view.q) === -1) return false;
      var stale = !r.lastUpdated || (Date.now() - new Date(r.lastUpdated).getTime()) / 86400000 > STALE_DAYS;
      if (view.filter === 'mount' && !r.mountUnlocked) return false;
      if (view.filter === 'locked' && r.mountUnlocked) return false;
      if (view.filter === 'six' && r.clearedCount !== 6) return false;
      if (view.filter === 'uncleared' && r.clearedCount === 6) return false;
      if (view.filter === 'stale' && !stale) return false;
      return true;
    });
    var sorters = {
      rank: function (a, b) { return a.rank - b.rank; },
      name: function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; },
      total: function (a, b) { return b.totalScore - a.totalScore || a.rank - b.rank; },
      remaining: function (a, b) { return a.remainingScore - b.remainingScore || a.rank - b.rank; },
      updated: function (a, b) { return String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')); }
    };
    return out.slice().sort(sorters[view.sort] || sorters.rank);
  }

  function cellLabel(dungeonDef, d) {
    return dungeonDef.name + ': ' + (d.cleared
      ? 'Master level ' + (d.bestMasterLevel === null ? 'unknown' : d.bestMasterLevel) + ', ' + num(d.points) + ' points'
      : 'not cleared');
  }

  function render() {
    var el = host();
    if (!el || !DATA) return;
    var season = DATA.season;
    var filtered = rows();
    var max = document.getElementById('seal-max');
    if (max) max.textContent = 'Maximum score ' + num(season.maxScore);

    var html = '';
    html += '<div class="seal-controls">' +
      '<input class="search" id="seal-search" type="search" placeholder="Search character name…" aria-label="Search Master Seal members" value="' + esc(view.q) + '">' +
      '<label class="seal-select">Sort' +
      '<select id="seal-sort" aria-label="Sort members">' +
      opt('rank', 'Rank') + opt('name', 'Character') + opt('total', 'Total score') +
      opt('remaining', 'Remaining points') + opt('updated', 'Last updated') +
      '</select></label>' +
      '<label class="seal-select">Show' +
      '<select id="seal-filter" aria-label="Filter members">' +
      fopt('all', 'All members') + fopt('mount', 'Mount unlocked') + fopt('locked', 'Mount locked') +
      fopt('six', 'Six of six cleared') + fopt('uncleared', 'Has uncleared dungeons') + fopt('stale', 'No update in ' + STALE_DAYS + ' days') +
      '</select></label>' +
      '<span class="seal-count" role="status">' + filtered.length + ' of ' + DATA.board.length + ' members</span>' +
      '</div>';

    html += '<div class="seal-layout">';
    html += '<div class="seal-tablewrap" role="region" aria-label="Guild member Master Seal table" tabindex="0">';
    if (!DATA.board.length) {
      html += '<div class="empty">No members yet — create the first account to open Season 3.</div>';
    } else if (!filtered.length) {
      html += '<div class="empty">No members match — clear a filter or search.</div>';
    } else {
      html += '<table class="seal-table"><thead><tr>' +
        '<th scope="col">Rank</th><th scope="col">Character</th><th scope="col">Total</th>' +
        '<th scope="col">Progress</th><th scope="col">Remaining</th><th scope="col">Cleared</th>' +
        '<th scope="col">Mount</th><th scope="col">Updated</th>' +
        season.dungeons.map(function (d) {
          return '<th scope="col" class="seal-dth"><span title="' + esc(d.name) + '">' + d.number + '</span></th>';
        }).join('') +
        '</tr></thead><tbody>';
      filtered.forEach(function (r) {
        var selected = r.name === view.selected;
        html += '<tr tabindex="0" data-member="' + esc(r.name) + '" aria-selected="' + selected + '"' + (selected ? ' class="selected"' : '') + '>' +
          '<td class="rank' + (r.rank <= 3 ? ' top' : '') + '" data-l="Rank">' + r.rank + '</td>' +
          '<td data-l="Character"><span class="pname">' + esc(r.name) + '</span></td>' +
          '<td data-l="Total"><span class="num">' + num(r.totalScore) + '</span> <span class="dim">/ ' + num(season.maxScore) + '</span></td>' +
          '<td data-l="Progress">' + r.progressPercent + '%<div class="bar"><i style="width:' + r.progressPercent + '%"></i></div></td>' +
          '<td data-l="Remaining"><span class="dim">' + num(r.remainingScore) + '</span></td>' +
          '<td data-l="Cleared"><span class="dim">' + r.clearedCount + ' / 6</span></td>' +
          '<td data-l="Mount">' + (r.mountUnlocked ? '<span class="badge gold">Neon Sonic</span>' : '<span class="dim">Locked</span>') + '</td>' +
          '<td data-l="Updated"><span class="dim">' + fmtDate(r.lastUpdated) + '</span></td>' +
          r.dungeons.map(function (d, i) {
            var def = season.dungeons[i];
            return '<td class="seal-cell' + (d.cleared ? '' : ' un') + '" data-l="' + esc(def.shortName) + '">' +
              '<span class="sr-only">' + esc(cellLabel(def, d)) + '</span>' +
              '<span aria-hidden="true" class="seal-m">' + (d.cleared && d.bestMasterLevel !== null ? 'M' + d.bestMasterLevel : '—') + '</span>' +
              '<span aria-hidden="true" class="seal-p">' + num(d.points) + '</span></td>';
          }).join('') +
          '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    html += '<aside class="seal-detail" id="seal-detail" aria-live="polite">' + detailHtml() + '</aside>';
    html += '</div>';
    el.innerHTML = html;
    wire(el);
  }

  function opt(value, label) { return '<option value="' + value + '"' + (view.sort === value ? ' selected' : '') + '>' + label + '</option>'; }
  function fopt(value, label) { return '<option value="' + value + '"' + (view.filter === value ? ' selected' : '') + '>' + label + '</option>'; }

  function detailHtml() {
    if (!DATA) return '';
    var member = null;
    DATA.board.forEach(function (r) { if (r.name === view.selected) member = r; });
    if (!member) return '<div class="empty">Select a member to inspect their Master Seal progress.</div>';
    var season = DATA.season;
    var html = '<div class="seal-member">' +
      '<span class="seal-avatar" aria-hidden="true">' + esc(member.name.charAt(0).toUpperCase()) + '</span>' +
      '<div><h3>' + esc(member.name) + '</h3>' +
      '<p class="dim">Rank ' + member.rank + ' · ' + season.displayName + '</p></div></div>';
    html += '<div class="seal-summary">' +
      stat('Total score', num(member.totalScore) + ' / ' + num(season.maxScore)) +
      stat('Remaining', num(member.remainingScore)) +
      stat('Cleared', member.clearedCount + ' / 6') +
      stat('Mount', member.mountUnlocked ? 'Neon Sonic unlocked' : 'Locked') +
      '</div>';
    html += '<div class="seal-progressbar"><div class="bar"><i style="width:' + member.progressPercent + '%"></i></div>' +
      '<span class="dim">' + member.progressPercent + '% · updated ' + fmtDate(member.lastUpdated) + '</span></div>';

    html += '<h4>Chaotic Realm dungeons</h4><div class="seal-cards">';
    member.dungeons.forEach(function (d, i) {
      var def = season.dungeons[i];
      html += '<article class="seal-card' + (d.cleared ? '' : ' un') + '">' +
        '<img src="' + dungeonImage(def) + '" alt="' + esc(def.name) + ' artwork" loading="lazy" onerror="this.hidden=true">' +
        '<div class="seal-card-body">' +
        '<span class="seal-card-no">' + def.number + '</span>' +
        '<strong>' + esc(def.name) + '</strong>' +
        (d.cleared
          ? '<span class="seal-card-stat">' + (d.bestMasterLevel !== null ? 'Master M' + d.bestMasterLevel : 'Cleared') + ' · ' + num(d.points) + ' pts</span>'
          : '<span class="seal-card-stat dim">Not cleared · 0 pts</span>') +
        '</div></article>';
    });
    html += '</div>';

    html += '<h4>Season 3 rewards</h4><div class="seal-rewards">';
    var nextFound = false;
    season.rewards.forEach(function (reward) {
      var earned = member.totalScore >= reward.score;
      var current = !earned && !nextFound;
      if (current) nextFound = true;
      var stateLabel = earned ? 'Earned' : current ? 'Next' : 'Locked';
      html += '<div class="seal-reward ' + (earned ? 'earned' : current ? 'current' : 'locked') + '">' +
        '<img src="' + rewardImage(reward) + '" alt="" loading="lazy" onerror="this.hidden=true">' +
        '<span class="seal-reward-score">' + num(reward.score) + '</span>' +
        '<span class="seal-reward-name">' + esc(reward.rewardName) + '</span>' +
        '<span class="seal-reward-state">' + stateLabel + '</span></div>';
    });
    html += '</div>';
    return html;
  }

  function stat(label, value) {
    return '<div class="seal-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function wire(el) {
    var search = el.querySelector('#seal-search');
    if (search) {
      search.addEventListener('input', function () {
        view.q = search.value.trim().toLowerCase();
        rerenderKeepingFocus('#seal-search');
      });
    }
    var sort = el.querySelector('#seal-sort');
    if (sort) sort.addEventListener('change', function () { view.sort = sort.value; render(); });
    var filter = el.querySelector('#seal-filter');
    if (filter) filter.addEventListener('change', function () { view.filter = filter.value; render(); });

    el.querySelectorAll('tr[data-member]').forEach(function (row) {
      row.addEventListener('click', function () { select(row.dataset.member); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(row.dataset.member);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          var sibling = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
          if (sibling && sibling.dataset.member) {
            select(sibling.dataset.member);
            var focusRow = host().querySelector('tr[data-member="' + CSS.escape(sibling.dataset.member) + '"]');
            if (focusRow) focusRow.focus();
          }
        }
      });
    });
  }

  function rerenderKeepingFocus(selector) {
    render();
    var again = host() && host().querySelector(selector);
    if (again) {
      again.focus();
      if (again.setSelectionRange && typeof again.value === 'string') {
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }
  }

  function select(name) {
    view.selected = name;
    render();
  }

  root.loadMasterSeal = loadMasterSeal;
  document.addEventListener('DOMContentLoaded', loadMasterSeal);
}(window));
