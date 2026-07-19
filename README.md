# OnlyPaws BPSR Guild Tracker

A build-free guild progression tracker backed by Google Sheets and Google Apps Script, with a static GitHub Pages interface at `https://daa13x.github.io/BPSR-Guild-Tracker/`. The imported leaderboard, ranking, achievement, event, reset-period, cache and audit logic remains the domain foundation.

## Architecture

- `Code.gs` owns the Sheets schema, server-calculated totals, rankings, progression events, achievements, reset periods, caching, audit utilities and the safe `GET /exec` health response.
- `AuthApi.gs` exposes the JSON `POST /exec` API, passwordless remembered-device accounts, backup-code restore, opaque hashed sessions and protected member/administrator actions.
- `MasterSeal.gs` holds the one authoritative Master Seal Season 3 configuration and the per-dungeon progress, validation, scoring and public-board logic.
- `Leaderboard.html`, `styles.css`, `config.js`, `AppFrontend.js` and `MasterSeal.js` are the static HTML/CSS/vanilla-JavaScript application. No React, bundler or production Node server is used.
- `index.html` opens `Leaderboard.html` with repository-relative paths suitable for the GitHub Pages project path.

```text
Code.gs                         Sheets/domain implementation
AuthApi.gs                      JSON API, accounts, sessions and role enforcement
MasterSeal.gs                   Master Seal Season 3 config, scoring and board
index.html                      GitHub Pages entry point
Leaderboard.html               Dashboard and public leaderboard
styles.css                      OnlyPaws application-shell design
config.js                       One authoritative Apps Script URL
AppFrontend.js                  Account gate, member and administrator controller
MasterSeal.js                   Public Master Seal board and detail panel
assets/guild-logo.png           Supplied transparent OnlyPaws logo
assets/master-seal/             Dungeon and reward artwork (webp)
scripts/dev-server.js           Local mock backend for development/smoke tests
.github/workflows/pages.yml     Root-folder Pages deployment
tests/                          Apps Script runtime and DOM-controller tests
```

## Accounts: remembered devices and backup codes

The tracker is passwordless. A first visit shows **Who are you?** with two visible paths: **New user** creates an account from only a character name; **Returning user** restores an existing account with the character name plus its backup code. There is no PIN or password anywhere in the active flow.

Creating an account generates a `BPSR-XXXX-XXXX-XXXX` backup code (strong randomness, no ambiguous characters) and a long-lived remembered-device session. The browser keeps only the opaque session token in a first-party cookie (`__Secure-bpsr-member-session` on HTTPS, path-scoped to the deployment); the backend stores only the token hash and decides identity and role on every request. The cookie never contains the character name, member ID, backup code, role or progression. Sessions default to 180 days (`MEMBER_SESSION_DAYS` in `Config`), track last use, and support sign-out of one device, revoke-all-devices, expiry and revocation.

Backup codes are compared case- and separator-insensitively. Restore failures return only “Character name or backup code is incorrect.” and five failures start a 15-minute throttle window. **This is a trusted-guild convenience system, not high-security identity proof.**

An explicit product decision: the readable backup code is stored in the private `Members` sheet so administrators can recover locked-out members. Consequences to accept and manage: spreadsheet editors can read codes and therefore impersonate members; the `Members`, `Sessions` and `LoginAttempts` sheets must stay protected and private; public API responses never contain codes; repository files never contain real codes; admin reveals and regenerations are audited without writing the code into the log.

`Players.IsAdmin` is the authoritative role flag. `Members.MemberId` and `Players.UserId` must be the same stable identifier and each member must map to exactly one player row. Administrator access requires a valid member session **and** a live `IsAdmin` check on every protected action — no admin flag is ever trusted from a cookie, and demotion or disabling takes effect immediately. Administrators can view, copy and regenerate a member’s backup code (regeneration kills the old code instantly and can optionally revoke every remembered device), revoke devices, rename, disable and merge members. Disabling revokes all of that member’s sessions; the last active administrator cannot be demoted, disabled or removed.

The initial administrator is Dax (`Players.IsAdmin=TRUE` on the row whose `UserId` equals Dax’s `Members.MemberId`). `BPSR_ADMIN_SECRET` remains optional, throttled, emergency-only recovery via Script Properties; the recovery session lives in browser memory only.

### Migration from the PIN system

Existing member IDs, progression, roles and achievements are preserved. On the first visit after the upgrade, a browser holding a still-valid legacy localStorage session exchanges it (`migrate` action) for a remembered-device cookie; the member’s backup code is generated if missing and shown once with “Please save this somewhere”, and the legacy storage is removed. A browser without a valid legacy session uses **Returning user** with the backup code — members without one contact an administrator, who generates or reveals it from the admin tools or the private sheet. PIN registration and login actions are removed from the API and UI; the dormant `PinSalt`/`PinHash` columns remain untouched for one release as rollback safety and may be cleared after live acceptance.

## Master Seal — Season 3

`MasterSeal.gs` defines the single authoritative season: six Chaotic Realm dungeons (Void - Towering Ruin, Void - Tina's Mindrealm, Cursed Radiant Tomb, Mech Facility, Mistveil Hunting Ground, Sea-Ringed Reef), a 3,650 maximum score and seven reward milestones (4 × 50 Rose Orbs, Avatar Frame, Namecard, and Mount: Neon Sonic at 3,650). Members record a best Master level (0–20 or Not cleared) and points per dungeon; no level-to-points formula is invented. The server derives every total: sum of the six point values, remaining (never below zero), progress (never above 100%), cleared count and mount unlock at exactly 3,650. Unknown dungeons, negative points, out-of-range levels and points on uncleared dungeons are rejected; identical updates write nothing.

The public board (`masterSeal` action) lists every active member — names only, no IDs — ranked by total score with all six dungeon values visible per row, search, sorting, filters, keyboard row selection and a detail panel with dungeon artwork and the reward track. Members edit only their own six dungeons through their session; administrators can correct any member with an audited action. Merging duplicates reassigns Master Seal rows to the kept member.

## Backend setup and redeployment

1. Back up the production spreadsheet and open **Extensions → Apps Script**.
2. Copy the final `Code.gs`, `AuthApi.gs` and `MasterSeal.gs` into the bound Apps Script project. `Leaderboard.html` is not required or served there: GitHub Pages hosts the interface, while Apps Script `/exec` hosts only the JSON API.
3. Run `setupSpreadsheet()` once. It is idempotent, does not seed demo members, appends the new `Members` columns (`BackupCode`, `BackupCodeCreatedAt`, `BackupCodeUpdatedAt`, `LastAccessAt`), adds `Sessions.LastUsedAt` and creates the `MasterSeal` sheet without touching existing data.
4. Verify every `Members.MemberId` has exactly one matching `Players.UserId`. In particular, verify Dax’s matching player row has `IsAdmin=TRUE` before relying on normal administrator access.
5. Review `Config` (including `MEMBER_SESSION_DAYS`), configure `MasterActivities`, and protect `Members`, `Sessions`, `LoginAttempts`, `MasterSeal`, events, achievements, resets and audit sheets. `Members` now holds readable backup codes and must stay private.
6. Optionally set Script Property `BPSR_ADMIN_SECRET` for emergency recovery. Never place a real backup code, hash, salt or token in repository files.
7. Choose **Deploy → Manage deployments**, edit the web-app deployment, select **New version**, and deploy with the access policy intended for the guild.
8. Copy the resulting HTTPS URL ending in `/exec`. A source edit is not live until a new Apps Script deployment version is created.

Opening `/exec` directly sends a `GET` request and returns this static JSON health response:

```json
{
  "ok": true,
  "service": "BPSR Guild Tracker API",
  "status": "ready",
  "message": "Use POST requests for API actions."
}
```

This confirms only that the deployed GET handler is reachable; it does not verify spreadsheet authorization, POST routing, authentication or Pages-origin behavior. The tracker interface remains `https://daa13x.github.io/BPSR-Guild-Tracker/`. Public and protected API actions use JSON `POST` requests, and credentials or session tokens must never be placed in the URL.

## Configure the one API URL

`config.js` is the only frontend API configuration source, and its `configuredApiUrl` constant is the single sanctioned location for the production `/exec` URL. The committed constant is the live production deployment URL; after redeploying the Apps Script web app under a new URL, update only that constant:

```js
var configuredApiUrl = 'https://script.google.com/macros/s/.../exec';
```

A fresh fork may instead carry the documented `PASTE_APPS_SCRIPT_EXEC_URL_HERE` placeholder until its own deployment exists; `npm run check` accepts exactly those two forms and still rejects deployment URLs anywhere else in the repository. Do not invent an URL and do not place credentials in it. `BPSR_CONFIG.apiUrl` sends JSON `POST` requests for public leaderboard, member and administrator actions; direct browser navigation to the same URL is only the GET health diagnostic.

For one-browser setup, `?api=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2F...%2Fexec` is also accepted. Only an explicitly supplied, valid Apps Script `/exec` URL — or, for development only, a `localhost`/`127.0.0.1` `/exec` URL such as the one `scripts/dev-server.js` prints — is stored under `bpsrApiUrl`; invalid or unrelated URLs fail closed. A persisted explicit override outranks the committed constant on later visits, so clear the site’s `bpsrApiUrl` local storage to return to the production deployment. Editing the constant is the recommended shared Pages configuration.

The sidebar reports **Not configured**, **Connecting**, **Connected**, or **API error**. The preview notice appears only while no valid API URL is configured. The public leaderboard interface remains viewable, but registration and saving are unavailable until the backend is connected.

## GitHub Pages

1. Open repository **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Merge an approved change to `main` or run **Deploy GitHub Pages** with `workflow_dispatch`.
4. Confirm the workflow succeeds and open `https://daa13x.github.io/BPSR-Guild-Tracker/`.
5. When changing `config.js`, `styles.css` or `AppFrontend.js`, bump the shared `?v=` cache token on their references in `Leaderboard.html` in the same commit. GitHub Pages serves every file with `Cache-Control: max-age=600`, so without a token bump browsers that visited recently keep the old assets for up to ten minutes and can show **Not configured** or stale behavior until then.
6. Hard-refresh after deploying, then verify the connection state and a harmless leaderboard request.

The workflow uploads the repository root. `.nojekyll`, `index.html`, `Leaderboard.html`, `config.js`, `styles.css`, `AppFrontend.js` and `assets/guild-logo.png` therefore retain project-relative URLs under `/BPSR-Guild-Tracker/`. A 404 usually means Pages Source is not GitHub Actions or deployment has not completed; a missing logo/script/style usually means a file or case-sensitive relative path is wrong; a failed publication is diagnosed in the Actions run log. If `/exec` still returns HTML or a missing-`Leaderboard` error, deploy a new Apps Script version. If the health GET succeeds but Pages cannot connect, verify `config.js`, deployment access, POST redirect/response behavior and the Apps Script execution log.

To replace the logo, overwrite `assets/guild-logo.png` with the approved transparent image at the same path, retain its aspect ratio, then verify both desktop and mobile. The sidebar supplies an OnlyPaws text fallback if the image fails.

## Validation and remaining live checks

Run:

```text
npm test
npm run check
git diff --check
```

Automated tests execute the real Apps Script sources in a mocked Sheets/Apps Script runtime and execute the frontend’s actual DOM event handlers and state transitions. For a full in-browser rehearsal without touching production data, run `node scripts/dev-server.js` and open the URL it prints — it serves the static frontend and exposes the same mocked backend as a real `POST /exec` endpoint, so account creation, backup-code restore, cookies, admin recovery and Master Seal editing can be driven end to end (mock recovery secret: `secret`; state resets on restart). Local automation cannot prove Google authorization, the production spreadsheet’s contents and protections, the deployed `/exec` CORS behavior, or the final Pages workflow. Complete `docs/DEPLOYMENT_CHECKLIST.md`, record the Apps Script deployment version and Git commit, and test the live origin before release.
