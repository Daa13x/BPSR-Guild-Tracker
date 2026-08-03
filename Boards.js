/* Public leaderboard boards. SV and Masters are two independent sections that
 * share this controller: each owns its own podium, search box, filter chips,
 * table and filter state, and both render the same loading, empty and failure
 * states so the two panels stay visually even. Also hosts the First Guildie
 * ribbon and the hash routing for the single dashboard page. */
'use strict';
var DATA = null;
var leaderboardLoadInFlight = null;
// Each board owns its own search and filter state so the SV and Masters
// sections behave as two independent leaderboards.
var BOARDS = ['sv', 'mp'];
var BOARD_LABELS = { sv: 'SV Leaderboard', mp: 'Masters Leaderboard' };
var state = {
  sv: { q:'', active:false, outdated:false, mount:false, svdone:false },
  mp: { q:'', active:false, outdated:false, mount:false, svdone:false }
};
// GitHub Pages and the protected controller share this one configuration source.
var API_URL = window.BPSR_CONFIG ? window.BPSR_CONFIG.apiUrl : '';
function api(action,data){ if(!API_URL) return Promise.reject(Object.assign(new Error('The tracker API is not configured.'),{code:'CONFIGURATION'}));
  return fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:action,data:data||{}})})
    .then(function(r){return r.text();}).then(function(t){var j;try{j=JSON.parse(t);}catch(e){throw Object.assign(new Error('The API returned a response the tracker could not read.'),{code:'BAD_RESPONSE'});}
      if(!j.ok){var failure=new Error((j.error&&j.error.message)||'Request could not be completed.');failure.code=j.error&&j.error.code;throw failure;}
      return j.data;}); }

/** Honest, specific failure text; raw backend strings go to the console. */
function classify(failure, context){
  if (window.BPSR_ERRORS) return window.BPSR_ERRORS.classify(failure, context);
  return { kind:'server', status:'Backend request failed', title:'Backend request failed',
    detail:'The backend responded but returned an unexpected server failure.' };
}

// ---------- data loading ----------
function load(){
  if (leaderboardLoadInFlight) return leaderboardLoadInFlight;
  var stampEl = document.getElementById('stamp');
  if (stampEl) stampEl.textContent = API_URL ? 'Loading…' : 'Preview data — no backend connected';
  setConnectionStatus(API_URL ? 'connecting' : 'not configured');
  BOARDS.forEach(function(key){ renderBoardState(key, 'loading', 'Loading ' + BOARD_LABELS[key] + '…', ''); });
  if (API_URL) {
    // Send the session token so a hidden viewer still receives their own row.
    var token = window.BPSR_SESSION ? window.BPSR_SESSION.token() : '';
    leaderboardLoadInFlight = api('leaderboard', token ? { token: token } : {}).then(function(d){DATA=d;setConnectionStatus('connected');render();}).catch(function(err){
      var failure = classify(err, 'leaderboard');
      setConnectionStatus(failure.status);
      if (stampEl) stampEl.textContent = failure.title;
      DATA = null;
      BOARDS.forEach(function(key){ renderBoardState(key, 'error', failure.title, failure.detail); });
    }).finally(function(){ leaderboardLoadInFlight = null; });
    return leaderboardLoadInFlight;
  } else {
    setConnectionStatus('not configured'); DATA = demoData(); render();
    return Promise.resolve(DATA);
  }
}
function setConnectionStatus(value){var el=document.getElementById('connection-status');if(el)el.textContent=value.charAt(0).toUpperCase()+value.slice(1);document.documentElement.dataset.connection=String(value).toLowerCase().replace(/\s+/g,'-');}
// The sidebar indicator is owned by MasterSealPage.js; Boards.js only reports
// board-load failures through the page stamp so the two never fight.

// ---------- rendering ----------
function render(){
  var d = DATA;
  var stampEl = document.getElementById('stamp');
  if (stampEl) stampEl.textContent =
    'Updated ' + fmtDateTime(d.generatedAt) + (API_URL ? '' : ' · preview only');

  BOARDS.forEach(renderBoard);
}

function boardRows(key){
  var d = DATA, f = state[key];
  var rows = key === 'sv' ? d.svBoard : d.mpBoard;
  return rows.filter(function(p){
    if (f.q && p.name.toLowerCase().indexOf(f.q) === -1) return false;
    if (f.active && p.outdated) return false;
    if (f.outdated && !p.outdated) return false;
    if (f.mount && !p.mount) return false;
    if (f.svdone && !p.svComplete) return false;
    return true;
  });
}

/** Podium slots are always three, so both sections keep the same height
 * whether or not the guild has enough ranked members yet. */
function renderPodium(key, full){
  var pod = document.getElementById('podium-' + key);
  if (!pod) return;
  var html = '';
  for (var i = 0; i < 3; i++){
    var p = full[i];
    var classes = 'banner pod-' + (i+1) + (i===0 ? ' gold' : '');
    if (!p){
      html += '<div class="' + classes + ' placeholder" aria-hidden="true">' +
        '<div class="medal">'+['I','II','III'][i]+'</div>' +
        '<div class="b-name">—</div><div class="b-stat">—</div>' +
        '<div class="b-sub">Unclaimed</div><div class="b-badges"></div></div>';
      continue;
    }
    var stat, sub;
    if (key === 'sv'){ stat='Floor '+p.sv; sub=p.svPct+'% of '+DATA.config.svMax; }
    else { stat=num(p.points)+' pts'; sub=num(p.pointsRemaining)+' to the mount'; }
    html += '<div class="' + classes + '">' +
      '<div class="medal">'+['I','II','III'][i]+'</div>' +
      '<div class="b-name">'+esc(p.name)+(p.verified?verifiedMark():'')+'</div>' +
      '<div class="b-stat">'+stat+'</div>' +
      '<div class="b-sub">'+sub+'</div>' +
      '<div class="b-badges">'+badges(p)+'</div></div>';
  }
  pod.innerHTML = html;
}

/** One shared presentation for the loading, empty and failure states so the
 * SV and Masters panels never drift apart structurally. */
function renderBoardState(key, kind, title, detail){
  var el = document.getElementById('board-' + key);
  var badge = document.getElementById('count-' + key);
  if (badge) badge.textContent = kind === 'loading' ? '…' : '—';
  renderPodium(key, []);
  if (!el) return;
  el.innerHTML = kind === 'loading'
    ? '<div class="board-state"><div class="ms-skeleton board-skeleton" aria-hidden="true"></div>' +
      '<p class="board-state-note" role="status">' + esc(title) + '</p></div>'
    : '<div class="board-state ms-empty' + (kind === 'error' ? ' is-error' : '') + '" role="status">' +
      '<strong>' + esc(title) + '</strong>' + (detail ? '<p>' + esc(detail) + '</p>' : '') + '</div>';
}

function renderBoard(key){
  var el = document.getElementById('board-' + key);
  var badge = document.getElementById('count-' + key);
  if (!el || !DATA) return;
  var rows = boardRows(key);
  var full = key === 'sv' ? DATA.svBoard : DATA.mpBoard;

  // Top-three podium banners use the unfiltered board order.
  renderPodium(key, full);
  if (badge) badge.textContent = full.length ? rows.length + ' / ' + full.length : '0';

  if (!full.length){
    el.innerHTML = '<div class="board-state ms-empty"><strong>No ranked guildies yet</strong>' +
      '<p>Members appear on this board once they record progress.</p></div>';
    return;
  }
  if (!rows.length){
    el.innerHTML = '<div class="board-state ms-empty"><strong>No guildies match</strong>' +
      '<p>No members match the current search and filters for this board.</p></div>';
    return;
  }

  var head, body;
  if (key === 'sv'){
    head = th(['Rank','Character','SV Floor','Progress','Badges','Last updated']);
    body = rows.map(function(p){
      var r = DATA.svBoard.indexOf(p)+1;
      return tr(r, [
        td('Character', nameCell(p)),
        td('SV floor','<span class="num">'+p.sv+'</span> <span class="dim">/ '+DATA.config.svMax+'</span>'),
        td('Progress', p.svPct+'%<div class="bar blue"><i style="width:'+p.svPct+'%"></i></div>'),
        td('Badges', badges(p, 'sv')),
        td('Updated', updated(p))
      ]);
    }).join('');
  } else {
    head = th(['Rank','Character','Master points','Progress to '+num(DATA.config.mountTarget),'Remaining','Mount','Score achieved','Last updated']);
    body = rows.map(function(p){
      var r = DATA.mpBoard.indexOf(p)+1;
      return tr(r, [
        td('Character', nameCell(p)),
        td('Points','<span class="num">'+num(p.points)+'</span>'),
        td('Progress', p.pointsPct+'%<div class="bar"><i style="width:'+p.pointsPct+'%"></i></div>'),
        td('Remaining','<span class="dim">'+num(p.pointsRemaining)+'</span>'),
        td('Mount', p.mount ? '<span class="badge gold">Mount earned</span>' : '<span class="dim">—</span>'),
        td('Achieved','<span class="dim">'+fmtDate(p.pointsDate)+'</span>'),
        td('Updated', updated(p))
      ]);
    }).join('');
  }
  el.innerHTML = '<table>'+head+'<tbody>'+body+'</tbody></table>';
}

function nameCell(p){
  var html = '<span class="pname">'+esc(p.name)+'</span>';
  if (p.verified) html += verifiedMark();
  if (p.hidden && DATA && p.name === DATA.viewerCharacter) html += ' <span class="badge hidden-badge" title="Hidden from other viewers — only you can see this row">Hidden — only you</span>';
  return html;
}
function verifiedMark(){
  return ' <span class="verified" title="Verified by a guild administrator" aria-label="Verified">' +
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 1.6l2.5 2.1 3.3-.3.9 3.2 2.9 1.7-1.1 3.1 1.1 3.1-2.9 1.7-.9 3.2-3.3-.3L12 22.4l-2.5-2.1-3.3.3-.9-3.2L2.4 15.7 3.5 12.6 2.4 9.5l2.9-1.7.9-3.2 3.3.3L12 1.6z"/>' +
    '<path fill="#0b0712" d="M10.6 15.2l-2.8-2.8 1.2-1.2 1.6 1.6 3.6-3.6 1.2 1.2z"/></svg></span>';
}

function badges(p, ctx){
  var out = '';
  if (p.svComplete) out += '<span class="badge blue">SV complete</span>';
  if (p.mount) out += '<span class="badge gold">Mount</span>';
  if (ctx==='sv'){
    if (p.easy) out += '<span class="badge ok">Easy</span>';
    if (p.hard) out += '<span class="badge hard">Hard</span>';
    if (p.raid) out += '<span class="badge ok">All Raids Completed</span>';
    if (p.master) out += '<span class="badge master">M1 First Runs</span>';
  }
  return out || '<span class="dim">—</span>';
}
function updated(p){
  return '<span class="dim">'+fmtDate(p.lastUpdated)+'</span>' +
    (p.outdated ? ' <span class="badge ember">outdated</span>' : '');
}
function th(cols){ return '<thead><tr>'+cols.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr></thead>'; }
function tr(rank, tds){
  return '<tr><td class="rank'+(rank<=3?' top':'')+'" data-l="Rank">'+rank+'</td>'+tds.join('')+'</tr>';
}
function td(label, html){ return '<td data-l="'+label+'">'+html+'</td>'; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function num(n){ return Number(n||0).toLocaleString(); }
// UK-style visible dates throughout the tracker.
function fmtDate(iso){ if(!iso) return '—'; return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDateTime(iso){ if(!iso) return '—'; return new Date(iso).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }


// ---------- navigation and hash routing ----------
// Only sections that genuinely exist are addressable. Any other hash — links
// to the removed Analytics sections above all — falls back to the SV
// leaderboard instead of scrolling to a section that is no longer on the page.
var SUPPORTED_HASHES = ['#overview', '#master-seal', '#seal-editor', '#sv-board', '#masters-board', '#my-progress', '#administration'];
var FALLBACK_HASH = '#sv-board';

function targetForHash(hash){
  if (SUPPORTED_HASHES.indexOf(hash) !== -1 && document.querySelector(hash)) return hash;
  return FALLBACK_HASH;
}

function markNav(hash){
  document.querySelectorAll('.ms-nav-item').forEach(function(item){
    var match = item.getAttribute('href') === hash;
    item.classList.toggle('selected', match);
    if (match) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  });
}

function routeHash(scroll){
  var raw = window.location.hash;
  var target = targetForHash(raw);
  if (raw && raw !== target){
    // Rewrite obsolete links in place so a refresh or a shared link never
    // reopens a section that has been removed from the page.
    history.replaceState(null, '', window.location.pathname + window.location.search + target);
  }
  markNav(target);
  if (!scroll) return;
  var node = document.querySelector(target);
  if (node && node.scrollIntoView) node.scrollIntoView({ behavior: raw ? 'auto' : 'auto', block: 'start' });
}

document.querySelectorAll('.ms-nav-item').forEach(function(link){
  link.addEventListener('click', function(){ markNav(link.getAttribute('href')); });
});
window.addEventListener('hashchange', function(){ routeHash(true); });
routeHash(Boolean(window.location.hash));

// ---------- interactions ----------
// Each leaderboard section wires its own search box and filter chips.
BOARDS.forEach(function(key){
  var search = document.getElementById('search-' + key);
  if (search) search.addEventListener('input', function(e){
    state[key].q = e.target.value.trim().toLowerCase();
    if (DATA) renderBoard(key);
  });
  [['f-active','active'],['f-outdated','outdated'],['f-mount','mount'],['f-svdone','svdone']].forEach(function(pair){
    var el = document.getElementById(pair[0] + '-' + key);
    if (!el) return;
    el.addEventListener('click', function(){
      state[key][pair[1]] = !state[key][pair[1]];
      el.setAttribute('aria-pressed', String(state[key][pair[1]]));
      if (DATA) renderBoard(key);
    });
  });
});
var refreshButton = document.getElementById('btn-refresh');
if (refreshButton) refreshButton.addEventListener('click', load);

var updateButton = document.getElementById('btn-update');
if (updateButton) updateButton.addEventListener('click', function(){
  var section = document.getElementById('my-progress');
  if (section) section.scrollIntoView({behavior:'smooth'});
  if (!API_URL) toast('Connect the Apps Script API to save progress.');
});

function toast(msg){
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display='none'; }, 4200);
}

// ---------- demo data (only when no API is configured) ----------
function demoData(){
  var day = 86400000, now = Date.now();
  function ago(d){ return new Date(now - d*day).toISOString(); }
  var names = ['Aelric','Brannwyn','Caelora','Dathrek','Eirwen','Fenmarr','Gilda','Hrothgar'];
  var players = names.map(function(n,i){
    var sv = [60,58,60,44,37,52,21,12][i];
    var pts = [3720,3650,3100,2400,1980,2900,900,410][i];
    var mount = pts >= 3650;
    return { name:n, sv:sv, svPct:Math.round(sv/60*100), svDate:ago(3+i*4), svComplete:sv>=60,
      easy:i<6, hard:i<4, points:pts, pointsPct:Math.min(100,Math.round(pts/3650*100)),
      pointsRemaining:Math.max(0,3650-pts), pointsDate:ago(1+i*3), mount:mount,
      lastUpdated:ago([1,2,0,9,22,4,31,3][i]), outdated:[false,false,false,false,true,false,true,false][i],
      verified:i<2, hidden:false };
  });
  var bySv = players.slice().sort(function(a,b){ return b.sv-a.sv || new Date(a.svDate)-new Date(b.svDate) || a.name.localeCompare(b.name); });
  var byMp = players.slice().sort(function(a,b){ return b.points-a.points || new Date(a.pointsDate)-new Date(b.pointsDate) || a.name.localeCompare(b.name); });
  return {
    generatedAt:new Date().toISOString(),
    config:{ mountTarget:3650, svMax:60, outdatedDays:14, timezone:'Europe/London', firstGuildieEnabled:true },
    svBoard:bySv, mpBoard:byMp,
    firstGuildie:{ enabled:true,
      current:{ periodId:'RP-demo', start:ago(2), end:new Date(now+5*day).toISOString(), type:'weekly', status:'Active',
        winner:{ name:'Caelora', at:ago(1.6), what:'Caelora reached SV Floor 60' } },
      previous:[ { periodId:'RP-prev1', start:ago(9), end:ago(2), type:'weekly', status:'Closed',
                   winner:{ name:'Fenmarr', at:ago(8.7), what:'Fenmarr completed M14 in Emberforge Gauntlet' } } ] },
    viewer:{ isAdmin:false, signedIn:false }, viewerCharacter:''
  };
}

load();
