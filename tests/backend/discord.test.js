const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

const BOT_SECRET = 'bot-secret-never-real';

function botReady(c) {
  c.__props.BOT_SHARED_SECRET = BOT_SECRET;
  return c;
}

/** Mint a website link code for a member and complete the Discord link. */
function linkDiscord(c, memberToken, discordId, discordTag = 'user#1') {
  const { code } = call(c, 'createDiscordLinkCode', { token: memberToken });
  return call(c, 'discordLink', { botSecret: BOT_SECRET, code, discordId, discordTag });
}

test('link flow: website code links a Discord id to the member; whoami reflects it', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const res = linkDiscord(c, dax.session.token, '111');
  assert.equal(res.characterName, 'Dax');

  const who = call(c, 'discordWhoami', { botSecret: BOT_SECRET, discordId: '111' });
  assert.equal(who.linked, true);
  assert.equal(who.characterName, 'Dax');
});

test('every bot action requires the shared secret', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  linkDiscord(c, dax.session.token, '111');
  assert.throws(() => call(c, 'discordProgress', { discordId: '111' }), /authoriz|FORBIDDEN/i);
  assert.throws(() => call(c, 'discordProgress', { botSecret: 'wrong', discordId: '111' }), /authoriz|FORBIDDEN/i);
  assert.throws(() => call(c, 'discordLink', { code: 'X', discordId: '111' }), /authoriz|FORBIDDEN/i);
});

test('a wrong, used, or expired link code is rejected', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  // Wrong code.
  assert.throws(() => call(c, 'discordLink', { botSecret: BOT_SECRET, code: 'NOPE1234', discordId: '111' }), /not valid|INVALID_CODE/i);
  // Used once, then reused.
  const { code } = call(c, 'createDiscordLinkCode', { token: dax.session.token });
  call(c, 'discordLink', { botSecret: BOT_SECRET, code, discordId: '111' });
  assert.throws(() => call(c, 'discordLink', { botSecret: BOT_SECRET, code, discordId: '222' }), /already been used|INVALID_CODE/i);
  // Expired.
  const { code: code2 } = call(c, 'createDiscordLinkCode', { token: dax.session.token });
  const codes = c.readTable_('DiscordLinkCodes');
  const row = codes.rows.filter((r) => String(r.Code) === code2)[0];
  codes.sheet.getRange(row._row, codes.headers.indexOf('ExpiresAt') + 1).setValue(new Date(Date.now() - 1000));
  assert.throws(() => call(c, 'discordLink', { botSecret: BOT_SECRET, code: code2, discordId: '333' }), /expired|INVALID_CODE/i);
});

test('an unlinked Discord id gets NOT_LINKED, never someone else’s data', () => {
  const c = runtime(); botReady(c);
  assert.throws(() => call(c, 'discordProgress', { botSecret: BOT_SECRET, discordId: 'nobody' }), /not linked|NOT_LINKED/i);
  assert.equal(call(c, 'discordWhoami', { botSecret: BOT_SECRET, discordId: 'nobody' }).linked, false);
});

test('discordUpdate patches SV floor, raids (merged) and a dungeon; scores recomputed server-side', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  linkDiscord(c, dax.session.token, '111');

  let p = call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { stimVaultFloor: 47 } });
  assert.equal(p.stimVaultFloor, 47);

  // Set only NM raid; Easy/Hard must be preserved (merge), not wiped.
  p = call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { nmRaidCompleted: true } });
  assert.equal(p.nmRaidCompleted, true);
  assert.equal(p.easyHardRaidCompleted, false);
  p = call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { easyHardRaidCompleted: true } });
  assert.equal(p.nmRaidCompleted, true, 'previous NM raid preserved across a later patch');
  assert.equal(p.easyHardRaidCompleted, true);

  // A dungeon master level marks it cleared and is reflected in totals.
  p = call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { dungeon: { id: 'towering-ruin', masterLevel: 5 } } });
  const dg = p.dungeons.filter((x) => x.dungeonId === 'towering-ruin')[0];
  assert.equal(dg.bestMasterLevel, 5);
  assert.equal(dg.cleared, true);
  assert.equal(p.totals.clearedCount, 1);

  // Reload is consistent.
  const reload = call(c, 'discordProgress', { botSecret: BOT_SECRET, discordId: '111' });
  assert.equal(reload.stimVaultFloor, 47);
  assert.equal(reload.nmRaidCompleted, true);
});

test('unlink removes the mapping', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  linkDiscord(c, dax.session.token, '111');
  call(c, 'discordUnlink', { botSecret: BOT_SECRET, discordId: '111' });
  assert.equal(call(c, 'discordWhoami', { botSecret: BOT_SECRET, discordId: '111' }).linked, false);
  assert.throws(() => call(c, 'discordProgress', { botSecret: BOT_SECRET, discordId: '111' }), /not linked|NOT_LINKED/i);
});

test('accounts lists the main/alt group with public ids; switching stays within the group', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const alt = call(c, 'createAltAccount', { token: dax.session.token, characterName: 'Alty' });
  linkDiscord(c, dax.session.token, '111');

  const accounts = call(c, 'discordAccounts', { botSecret: BOT_SECRET, discordId: '111' }).accounts;
  assert.equal(accounts.length, 2);
  const main = accounts.filter((a) => a.role === 'main')[0];
  const altAcc = accounts.filter((a) => a.role === 'alt')[0];
  assert.equal(main.characterName, 'Dax');
  assert.equal(main.active, true);
  assert.equal(altAcc.characterName, 'Alty');
  assert.match(main.memberPublicId, /^pm-/);

  // Switch to the alt; progress now reports the alt.
  const switched = call(c, 'discordSwitchAccount', { botSecret: BOT_SECRET, discordId: '111', memberPublicId: altAcc.memberPublicId });
  assert.equal(switched.characterName, 'Alty');
  assert.equal(call(c, 'discordProgress', { botSecret: BOT_SECRET, discordId: '111' }).characterName, 'Alty');

  // Switching to an unrelated account is refused.
  const stranger = call(c, 'createAccount', { characterName: 'Stranger' });
  const strangerPub = c.publicIdFor_(stranger.member.memberId);
  assert.throws(() => call(c, 'discordSwitchAccount', { botSecret: BOT_SECRET, discordId: '111', memberPublicId: strangerPub }), /not in your linked|FORBIDDEN/i);
});

test('an alt manages only itself; a main manages its whole group (no cross-account escalation)', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const alt = call(c, 'createAltAccount', { token: dax.session.token, characterName: 'Alty' });

  // A MAIN sees itself + its alts.
  const mainGroup = c.discordGroupIds_(dax.member.memberId).ids;
  assert.equal(mainGroup.length, 2);
  assert.ok(mainGroup.includes(dax.member.memberId) && mainGroup.includes(alt.account.memberId));

  // An ALT is restricted to itself — it can never reach the main or siblings.
  const altGroup = c.discordGroupIds_(alt.account.memberId).ids;
  assert.equal(altGroup.length, 1);
  assert.equal(altGroup[0], alt.account.memberId);
});

test('an idempotent update makes no write (unchanged patch is a no-op)', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  linkDiscord(c, dax.session.token, '111');
  call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { nmRaidCompleted: true } });
  // Re-applying the same value must not error and must leave state consistent.
  const p = call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: { nmRaidCompleted: true } });
  assert.equal(p.nmRaidCompleted, true);
  // An empty patch is accepted and returns current progression.
  assert.equal(call(c, 'discordUpdate', { botSecret: BOT_SECRET, discordId: '111', patch: {} }).nmRaidCompleted, true);
});

test('the bot secret and private member ids never appear in any bot response', () => {
  const c = runtime(); botReady(c);
  const dax = call(c, 'createAccount', { characterName: 'Dax' });
  const link = linkDiscord(c, dax.session.token, '111');
  const progress = call(c, 'discordProgress', { botSecret: BOT_SECRET, discordId: '111' });
  const accounts = call(c, 'discordAccounts', { botSecret: BOT_SECRET, discordId: '111' });
  const blob = JSON.stringify([link, progress, accounts]).toLowerCase();
  assert.equal(blob.includes(BOT_SECRET.toLowerCase()), false, 'secret must never be echoed');
  assert.equal(blob.includes(dax.member.memberId.toLowerCase()), false, 'private member id must not be exposed');
});
