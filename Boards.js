/* Public leaderboard boards: SV, Master Points, Master Completion and the
 * Mount Hall of Fame, plus the First Guildie ribbon, achievement records and
 * the activity feed. Extracted from the page so one dashboard shell can host
 * every section. */
'use strict';
var DATA = null;
// Each board owns its own search and filter state so the SV and Masters
// sections behave as two independent leaderboards.
var BOARDS = ['sv', 'mp'];
var state = {
  sv: { q:'', active:false, outdated:false, mount:false, svdone:false },
  mp: { q:'', active:false, outdated:false, mount:false, svdone:false }
};
// GitHub Pages and the protected controller share this one configuration source.
var API_URL = window.BPSR_CONFIG ? window.BPSR_CONFIG.apiUrl : '';
function api(action,data){ if(!API_URL) return Promise.reject(new Error('API URL is not configured. Add ?api=YOUR_EXEC_URL once.'));
  return fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:action,data:data||{}})})
    .then(function(r){return r.text();}).then(function(t){var j;try{j=JSON.parse(t);}catch(e){throw new Error('The API returned an invalid response.');}if(!j.ok)throw new Error((j.error&&j.error.message)||'Request could not be completed.');return j.data;}); }

// ---------- data loading ----------
function load(){
  document.getElementById('stamp').textContent = 'Loading…';
  setConnectionStatus(API_URL ? 'connecting' : 'not configured');
  if (API_URL) {
    api('leaderboard',{}).then(function(d){DATA=d;setConnectionStatus('connected');render();}).catch(function(err){setConnectionStatus('API error');document.getElementById('stamp').textContent=err.message;});
  } else {
    setConnectionStatus('not configured'); DATA = demoData(); render();
  }
}
function setConnectionStatus(value){var el=document.getElementById('connection-status');if(el)el.textContent=value.charAt(0).toUpperCase()+value.slice(1);document.documentElement.dataset.connection=value.replace(/\s+/g,'-');}

// ---------- rendering ----------
function render(){
  var d = DATA;
  document.getElementById('stamp').textContent =
    'Updated ' + fmtDateTime(d.generatedAt) + (API_URL ? '' : ' · preview only');

  renderFirstGuildie();
  BOARDS.forEach(renderBoard);
  renderFirsts();
  renderFeed();
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

function renderBoard(key){
  var el = document.getElementById('board-' + key);
  var pod = document.getElementById('podium-' + key);
  if (!el || !pod) return;
  var rows = boardRows(key);
  var full = key === 'sv' ? DATA.svBoard : DATA.mpBoard;

  // Top-three podium banners use the unfiltered board order.
  pod.innerHTML = full.slice(0,3).map(function(p,i){
    var medal = ['I','II','III'][i];
    var stat, sub;
    if (key === 'sv'){ stat='Floor '+p.sv; sub=p.svPct+'% of '+DATA.config.svMax; }
    else { stat=num(p.points)+' pts'; sub=num(p.pointsRemaining)+' to the mount'; }
    return '<div class="banner pod-'+(i+1)+(i===0?' gold':'')+'">' +
      '<div class="medal">'+medal+'</div>' +
      '<div class="b-name">'+esc(p.name)+'</div>' +
      '<div class="b-stat">'+stat+'</div>' +
      '<div class="b-sub">'+sub+'</div>' +
      '<div class="b-badges">'+badges(p)+'</div></div>';
  }).join('');
  if (!full.length) pod.innerHTML='';

  if (!rows.length){
    el.innerHTML = '<div class="empty">No guildies match — clear a filter or be the first to register.</div>';
    return;
  }

  var head, body;
  if (key === 'sv'){
    head = th(['Rank','Character','SV Floor','Progress','Floor achieved','Badges','Last updated']);
    body = rows.map(function(p){
      var r = DATA.svBoard.indexOf(p)+1;
      return tr(r, [
        td('Character','<span class="pname">'+esc(p.name)+'</span>'),
        td('SV floor','<span class="num">'+p.sv+'</span> <span class="dim">/ '+DATA.config.svMax+'</span>'),
        td('Progress', p.svPct+'%<div class="bar blue"><i style="width:'+p.svPct+'%"></i></div>'),
        td('Achieved','<span class="dim">'+fmtDate(p.svDate)+'</span>'),
        td('Badges', badges(p, 'sv')),
        td('Updated', updated(p))
      ]);
    }).join('');
  } else {
    head = th(['Rank','Character','Master points','Progress to '+num(DATA.config.mountTarget),'Remaining','Mount','Score achieved','Last updated']);
    body = rows.map(function(p){
      var r = DATA.mpBoard.indexOf(p)+1;
      return tr(r, [
        td('Character','<span class="pname">'+esc(p.name)+'</span>'),
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

function renderFirstGuildie(){
  var fg = DATA.firstGuildie, panel = document.getElementById('fg-panel');
  panel.hidden = !fg.enabled;
  if (!fg.enabled) return;
  var c = fg.current, el = document.getElementById('fg-card'), html = '';
  if (c && c.winner){
    html += '<div class="fg-badge">1st</div><div class="fg-main">' +
      '<div class="fg-name">'+esc(c.winner.name)+'</div>' +
      '<div class="fg-what">'+esc(c.winner.what)+'</div>' +
      '<div class="fg-meta">'+fmtDateTime(c.winner.at)+' · '+periodLabel(c)+'</div></div>';
  } else {
    html += '<div class="fg-main"><div class="fg-empty">No winner yet this period — the badge goes to the first genuine progress update.</div>' +
      (c ? '<div class="fg-meta">'+periodLabel(c)+'</div>' : '') + '</div>';
  }
  var prev = fg.previous.filter(function(p){ return p.winner; });
  if (prev.length){
    html += '<details class="fg-prev"><summary>Previous winners ('+prev.length+')</summary><div class="fg-prev-list">' +
      prev.map(function(p){ return '<div><b>'+esc(p.winner.name)+'</b> — '+esc(p.winner.what)+' · '+fmtDateTime(p.winner.at)+'</div>'; }).join('') +
      '</div></details>';
  }
  el.innerHTML = html;
}

function renderFirsts(){
  var el = document.getElementById('firsts');
  if (!DATA.firsts.length){ el.innerHTML = '<div class="empty">No achievement records yet.</div>'; return; }
  var actNames = {}; DATA.activities.forEach(function(a){ actNames[a.id]=a.name; });
  el.innerHTML = DATA.firsts.map(function(f){
    return '<div class="first-card"><div class="first-type">'+esc(firstLabel(f, actNames))+'</div>' +
      '<div class="first-name">'+esc(f.name)+(f.corrected?' <span class="badge ember">corrected</span>':'')+'</div>' +
      '<div class="first-date">'+fmtDateTime(f.at)+'</div></div>';
  }).join('');
}

function firstLabel(f, actNames){
  if (f.type==='FIRST_SV_FLOOR_60') return 'First to SV Floor 60';
  if (f.type==='FIRST_MOUNT') return 'First to earn the mount';
  if (f.type==='FIRST_ALL_MASTERS') return 'First to complete every Master activity';
  if (f.type.indexOf('FIRST_MMAX_')===0) return 'First to max ' + (actNames[f.activityId]||f.activityId);
  if (f.type.indexOf('FIRST_MILESTONE_')===0) return 'First to milestone: ' + f.type.replace('FIRST_MILESTONE_','');
  return f.type;
}

function renderFeed(){
  var panel = document.getElementById('feed-panel');
  panel.hidden = false;
  var feed = document.getElementById('feed');
  if (!DATA.config.feedEnabled){ feed.innerHTML = '<li class="empty">Activity feed is not enabled.</li>'; return; }
  if (!DATA.feed.length){ feed.innerHTML = '<li class="empty">No recent guild activity yet.</li>'; return; }
  feed.innerHTML = DATA.feed.map(function(e){
    return '<li><time>'+fmtRelative(e.at)+'</time><span>'+esc(e.text)+'</span></li>';
  }).join('');
}

// ---------- helpers ----------
function badges(p, ctx){
  var out = '';
  if (p.svComplete) out += '<span class="badge blue">SV complete</span>';
  if (p.mount) out += '<span class="badge gold">Mount</span>';
  if (ctx==='sv'){ if (p.easy) out += '<span class="badge ok">Easy</span>'; if (p.hard) out += '<span class="badge ok">Hard</span>'; }
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
function fmtDate(iso){ if(!iso) return '—'; return new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }
function fmtDateTime(iso){ if(!iso) return '—'; return new Date(iso).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function fmtRelative(iso){
  var s = (Date.now()-new Date(iso).getTime())/1000;
  if (s<3600) return Math.max(1,Math.round(s/60))+' min ago';
  if (s<86400) return Math.round(s/3600)+' h ago';
  if (s<86400*7) return Math.round(s/86400)+' d ago';
  return fmtDate(iso);
}
function periodLabel(c){
  var t = c.type.charAt(0).toUpperCase()+c.type.slice(1);
  return t+' period · started '+fmtDate(c.start)+(c.end?' · resets '+fmtDate(c.end):'');
}

// ---------- interactions ----------
document.querySelectorAll('.ms-nav-item').forEach(function(link){
  link.addEventListener('click', function(){
    document.querySelectorAll('.ms-nav-item').forEach(function(item){
      item.classList.remove('selected'); item.removeAttribute('aria-current');
    });
    link.classList.add('selected');
    link.setAttribute('aria-current','page');
  });
});

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
document.getElementById('btn-refresh').addEventListener('click', load);

document.getElementById('btn-update').addEventListener('click', function(){
  document.getElementById('my-progress').scrollIntoView({behavior:'smooth'});
  if (!API_URL) toast('Connect the Apps Script API to save progress.');
});

function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display='none'; }, 4200);
}

// ---------- demo data (only when opened outside Apps Script) ----------
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
      mountAt:mount?ago(10+i*5):null, mountPosition:mount?(i===1?1:2):null, mountPoints:mount?3650+(i===0?40:0):null,
      mastersAtMax:[5,4,3,2,1,3,0,0][i], totalRanks:[100,92,78,55,41,70,18,6][i],
      mastersDate:ago(6+i*2), lastUpdated:ago([1,2,0,9,22,4,31,3][i]), outdated:[false,false,false,false,true,false,true,false][i] };
  });
  var bySv = players.slice().sort(function(a,b){ return b.sv-a.sv || new Date(a.svDate)-new Date(b.svDate) || a.name.localeCompare(b.name); });
  var byMp = players.slice().sort(function(a,b){ return b.points-a.points || new Date(a.pointsDate)-new Date(b.pointsDate) || a.name.localeCompare(b.name); });
  var byMc = players.slice().sort(function(a,b){ return b.mastersAtMax-a.mastersAtMax || b.totalRanks-a.totalRanks || b.points-a.points; });
  return {
    generatedAt:new Date().toISOString(),
    config:{ mountTarget:3650, svMax:60, outdatedDays:14, overallEnabled:false, feedEnabled:true, firstGuildieEnabled:true, timezone:'Europe/London' },
    activities:[{id:'ACT1',name:'Trials of the Deep',maxRank:20},{id:'ACT2',name:'Emberforge Gauntlet',maxRank:20},{id:'ACT3',name:'Stormcaller Rites',maxRank:20},{id:'ACT4',name:'Wardens of the Vale',maxRank:20},{id:'ACT5',name:'The Long Vigil',maxRank:20}],
    svBoard:bySv, mpBoard:byMp, mcBoard:byMc,
    hallOfFame:[ {position:1,name:'Brannwyn',points:3650,at:ago(41),corrected:false},
                 {position:2,name:'Aelric',points:3690,at:ago(18),corrected:false} ],
    firsts:[ {type:'FIRST_MOUNT',name:'Brannwyn',activityId:'',value:'3650',at:ago(41),corrected:false},
             {type:'FIRST_SV_FLOOR_60',name:'Aelric',activityId:'',value:'60',at:ago(33),corrected:false},
             {type:'FIRST_MMAX_ACT1',name:'Caelora',activityId:'ACT1',value:'20',at:ago(26),corrected:false} ],
    firstGuildie:{ enabled:true,
      current:{ periodId:'RP-demo', start:ago(2), end:new Date(now+5*day).toISOString(), type:'weekly', status:'Active',
        winner:{ name:'Caelora', at:ago(1.6), what:'Caelora reached SV Floor 60' } },
      previous:[ { periodId:'RP-prev1', start:ago(9), end:ago(2), type:'weekly', status:'Closed',
                   winner:{ name:'Fenmarr', at:ago(8.7), what:'Fenmarr completed M14 in Emberforge Gauntlet' } },
                 { periodId:'RP-prev2', start:ago(16), end:ago(9), type:'weekly', status:'Closed',
                   winner:{ name:'Aelric', at:ago(15.9), what:'Aelric is on 3,720 Master points' } } ] },
    feed:[ {at:ago(0.1),text:'Caelora reached SV Floor 60'},
           {at:ago(0.8),text:'Aelric is on 3,720 Master points'},
           {at:ago(1.6),text:'Caelora reached SV Floor 60'},
           {at:ago(2.4),text:'Fenmarr completed M16 in Stormcaller Rites'},
           {at:ago(4.2),text:'Hrothgar completed Easy'},
           {at:ago(18),text:'Aelric earned the mount'} ],
    viewer:{ isAdmin:true, signedIn:true }, viewerCharacter:'Aelric'
  };
}

load();
