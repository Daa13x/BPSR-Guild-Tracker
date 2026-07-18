/** JSON API and character/PIN identity layer.  This file deliberately wraps
 * the imported leaderboard domain code rather than duplicating it. */
var AUTH_SHEETS = { MEMBERS: 'Members', SESSIONS: 'Sessions', ATTEMPTS: 'LoginAttempts' };
var SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function ensureAuthSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, AUTH_SHEETS.MEMBERS, ['MemberId','CharacterName','NormalizedName','PinSalt','PinHash','CreatedAt','DisabledAt']);
  ensureSheet_(ss, AUTH_SHEETS.SESSIONS, ['TokenHash','MemberId','Kind','ExpiresAt','RevokedAt','CreatedAt']);
  ensureSheet_(ss, AUTH_SHEETS.ATTEMPTS, ['Key','Count','WindowStarted','BlockedUntil']);
}
function normalizeCharacterName_(name) { return sanitizeName_(name).replace(/\s+/g, ' ').toLowerCase(); }
function requireCharacterName_(name) { var clean=sanitizeName_(name); if (!/^[\p{L}\p{N}][\p{L}\p{N} '\-]{1,39}$/u.test(clean)) throw new Error('Invalid character name.'); return clean; }
function requirePin_(pin) { if (typeof pin !== 'string' || !/^\d{6,64}$/.test(pin)) throw new Error('Invalid credentials.'); }
function digest_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join(''); }
function safeCell_(value) { var s=String(value||''); return /^[=+\-@]/.test(s) ? "'"+s : s; }
function memberRows_() { return readTable_(AUTH_SHEETS.MEMBERS).rows; }
function findMemberByName_(normalized) { return memberRows_().filter(function(r){ return String(r.NormalizedName) === normalized && !r.DisabledAt; })[0] || null; }
function sessionToken_() { return Utilities.getUuid()+Utilities.getUuid(); }
function createSession_(memberId, kind) { var token=sessionToken_(), expires=new Date(Date.now()+SESSION_TTL_MS); SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEETS.SESSIONS).appendRow([digest_(token),memberId,kind,expires,'',new Date()]); return { token:token, expiresAt:expires.toISOString() }; }
function session_(token, kind) { if(typeof token!=='string'||token.length<20) throw new Error('Session expired.'); var row=readTable_(AUTH_SHEETS.SESSIONS).rows.filter(function(r){return String(r.TokenHash)===digest_(token)&&String(r.Kind)===kind&&!r.RevokedAt&&new Date(r.ExpiresAt)>new Date();})[0]; if(!row) throw new Error('Session expired.'); return row; }
function revoke_(token) { var t=readTable_(AUTH_SHEETS.SESSIONS); t.rows.forEach(function(r){if(String(r.TokenHash)===digest_(token)&&!r.RevokedAt)t.sheet.getRange(r._row,5).setValue(new Date());}); }
function registerMember_(p) { ensureAuthSheets_(); var name=requireCharacterName_(p.characterName), norm=normalizeCharacterName_(name); requirePin_(p.pin); if(findMemberByName_(norm)) throw new Error('Character name is unavailable.'); var salt=Utilities.getUuid(), id=uid_('MEM'); SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEETS.MEMBERS).appendRow([id,safeCell_(name),norm,salt,digest_(salt+':'+p.pin),new Date(),'']); return {member:{characterName:name},session:createSession_(id,'member')}; }
function loginMember_(p) { ensureAuthSheets_(); var norm=normalizeCharacterName_(p.characterName||''), key=digest_(norm), attempts=readTable_(AUTH_SHEETS.ATTEMPTS), a=attempts.rows.filter(function(r){return String(r.Key)===key;})[0]; if(a&&a.BlockedUntil&&new Date(a.BlockedUntil)>new Date()) throw new Error('Invalid character name or PIN.'); var m=findMemberByName_(norm), ok=false; if(m&&typeof p.pin==='string') ok=digest_(String(m.PinSalt)+':'+p.pin)===String(m.PinHash); if(!ok){ var count=(a?Number(a.Count):0)+1, blocked=count>=5?new Date(Date.now()+15*60000):''; if(a) attempts.sheet.getRange(a._row,2,1,3).setValues([[count,a.WindowStarted||new Date(),blocked]]); else attempts.sheet.appendRow([key,count,new Date(),blocked]); throw new Error('Invalid character name or PIN.'); } return {member:{characterName:String(m.CharacterName)},session:createSession_(m.MemberId,'member')}; }
function adminLogin_(p) { var secret=PropertiesService.getScriptProperties().getProperty('BPSR_ADMIN_SECRET'); if(!secret||typeof p.secret!=='string'||digest_(p.secret)!==digest_(secret)) throw new Error('Invalid credentials.'); return {session:createSession_('admin','admin')}; }
function doPost(e) { try { var raw=(e&&e.postData&&e.postData.contents)||'', p=JSON.parse(raw); if(raw.length>20000) throw new Error('Invalid request.'); var action=p.action, data=p.data||{}, result; if(action==='register')result=registerMember_(data); else if(action==='login')result=loginMember_(data); else if(action==='adminLogin')result=adminLogin_(data); else if(action==='logout'){revoke_(data.token);result={ok:true};} else if(action==='leaderboard')result=JSON.parse(getLeaderboardBundle()); else throw new Error('Unknown action.'); return ContentService.createTextOutput(JSON.stringify({ok:true,data:result})).setMimeType(ContentService.MimeType.JSON); } catch(err) { return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Request could not be completed.'})).setMimeType(ContentService.MimeType.JSON); } }
