#!/usr/bin/env node

const assert = require('node:assert/strict');

const apiUrl = String(process.argv[2] || process.env.BPSR_API_URL || '').trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(apiUrl)) {
  console.error('Usage: npm run smoke:deployment -- <Apps Script /exec URL>');
  process.exit(2);
}

async function jsonResponse(response, label) {
  const text = await response.text();
  assert.equal(response.ok, true, `${label}: HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`${label}: deployment returned non-JSON content`);
  }
}

async function post(action) {
  return jsonResponse(await fetch(apiUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data: {} }),
    signal: AbortSignal.timeout(60000)
  }), `POST ${action}`);
}

async function main() {
  const health = await jsonResponse(await fetch(apiUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60000)
  }), 'GET health');
  assert.equal(health.ok, true, 'GET health: expected ok=true');
  assert.equal(health.status, 'ready', 'GET health: expected status=ready');

  const activities = await post('activities');
  assert.equal(activities.ok, true, 'POST activities: expected ok=true');
  assert.ok(Array.isArray(activities.data), 'POST activities: expected an activity array');

  const leaderboard = await post('leaderboard');
  assert.equal(leaderboard.ok, true, 'POST leaderboard: expected ok=true');
  assert.ok(leaderboard.data && Array.isArray(leaderboard.data.svBoard),
    'POST leaderboard: expected the leaderboard bundle, not the GET health payload');

  const masterSeal = await post('masterSeal');
  assert.equal(masterSeal.ok, true, 'POST masterSeal: expected ok=true');
  assert.ok(masterSeal.data && masterSeal.data.season && Array.isArray(masterSeal.data.board),
    'POST masterSeal: expected the Season 3 board');

  const invalid = await post('__deployment_smoke_unknown__');
  assert.equal(invalid.ok, false, 'POST unknown action: expected ok=false');
  assert.equal(invalid.error && invalid.error.code, 'UNKNOWN_ACTION',
    'POST unknown action: expected the AuthApi dispatcher');

  console.log(JSON.stringify({
    ok: true,
    status: health.status,
    activities: activities.data.length,
    leaderboardMembers: leaderboard.data.svBoard.length,
    masterSealMembers: masterSeal.data.board.length,
    unknownAction: invalid.error.code
  }));
}

main().catch(error => {
  console.error(`Deployment smoke failed: ${error.message}`);
  process.exitCode = 1;
});
