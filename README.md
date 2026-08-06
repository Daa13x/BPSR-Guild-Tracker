# OnlyPaws BPSR Guild Tracker

A build-free guild progression tracker backed by Google Sheets and Google Apps Script, with a static GitHub Pages interface at `https://daa13x.github.io/BPSR-Guild-Tracker/`. The imported leaderboard, ranking, achievement, event, reset-period, cache and audit logic remains the domain foundation.

## Architecture

- `Code.gs` owns the Sheets schema, server-calculated totals, rankings, progression events, achievements, reset periods, caching, audit utilities and the safe `GET /exec` health response.
- `AuthApi.gs` exposes the JSON `POST /exec` API, passwordless remembered-device accounts, backup-code restore, opaque hashed sessions and protected member/administrator actions.
- `MasterSeal.gs` holds the one authoritative Master Seal Season 3 configuration and the per-dungeon progress, validation, scoring and public-board logic.
- `Leaderboard.html`, `styles.css`, `master-seal.css`, `config.js`, `Boards.js`, `MasterSealPage.js` and `AppFrontend.js` are the static HTML/CSS/vanilla-JavaScript application. No React, bundler or production Node server is used. Every asset is loaded with a `?v=` cache token; **bump that token whenever one of these files changes**, or browsers and the Pages CDN keep serving the previous version.
- `index.html` opens `Leaderboard.html` with repository-relative paths suitable for the GitHub Pages project path.

```text
Code.gs                         Sheets/domain implementation
AuthApi.gs                      JSON API, accounts, sessions and role enforcement
MasterSeal.gs                   Master Seal Season 3 config, scoring and board
index.html                      GitHub Pages entry point
Leaderboard.html               Dashboard and public leaderboard
styles.css                      OnlyPaws application-shell design
config.js                       One authoritative Apps Script URL
master-seal.css                 Dashboard theme and board components
Boards.js                       SV and Masters leaderboards, hash routing
MasterSealPage.js               Master Seal board and detail panel
AppFrontend.js                  Account gate, member and administrator controller
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

### Finding a backup code

Codes are `BPSR-XXXX-XXXX-XXXX` and are generated lazily: on account creation, on the first successful restore, or when an administrator regenerates one. A member migrated from the PIN system has an empty `BackupCode` until one of those happens — regenerate to mint one.

Three ways to read a code:

1. **`BackupCodes` sheet** — one row per member (`MemberId`, `CharacterName`, `BackupCode`, `CreatedAt`, `UpdatedAt`, `Status`), kept in step automatically when a code is created or regenerated, when a member is renamed, and when one is disabled or enabled. This is a lookup mirror for administrators; **`Members` remains the single source of truth for restore**, so a stale, edited or deleted row here cannot lock anyone out. Run `rebuildBackupCodes()` once from the Apps Script editor to populate it for members who existed before the sheet did, and any time you want it rebuilt — it is idempotent.
2. **Your own code** — sign in, then **My Progress → Backup access → Reveal / Copy**.
3. **Any member's code** — **Administration → Backup access**, select the member, then **Reveal backup code**. Every reveal writes a `VIEW_BACKUP_CODE` audit entry naming the administrator and the target.

### "Character name or backup code is incorrect."

`restore` returns that one message for every failure so the API cannot be used to work out which character names exist. To find the real reason, run **`diagnoseRestore("Dax")`** from the Apps Script editor — it reports whether a `Members` row was found, whether `NormalizedName` matches, whether the row is disabled, whether a code is set, and whether the throttle is blocking, and never returns the code itself. The usual causes:

| Cause | Fix |
|---|---|
| No code stored yet (lazy generation — most common for pre-existing accounts) | `issueBackupCode("Dax")`, or **Regenerate backup code** in the admin panel |
| `NormalizedName` does not match the lower-cased name | correct that cell in `Members` |
| `DisabledAt` is set | clear it, or enable the member |
| Five failures in 15 minutes | blocked for 15 minutes — `clearLoginThrottle("Dax")`, or clear the row in `LoginAttempts` |
| The code typed genuinely differs | reissue it |

Character names and codes are both matched case-insensitively, and codes ignore dashes and spaces, so `bpsr-abcd-efgh-jkmn` and `BPSR ABCD EFGH JKMN` are equivalent.

`diagnoseRestore`, `issueBackupCode`, `clearLoginThrottle` and `rebuildBackupCodes` are editor-only maintenance functions. They are deliberately not wired into the API dispatcher, so the web app cannot reach them — a test asserts each one returns `UNKNOWN_ACTION` if requested over HTTP.

Codes are stored readable so administrators can recover members. That is a deliberate trade for a trusted guild: protecting or hiding a tab does not stop anyone who can open the spreadsheet from reading it, so **file-level sharing is the only real access boundary** — keep the spreadsheet restricted to administrators you trust. If you would rather nobody could read a code at all, store hashes instead and recover by regenerating; that removes the Reveal button by design.

The initial administrator is Dax (`Players.IsAdmin=TRUE` on the row whose `UserId` equals Dax’s `Members.MemberId`). `BPSR_ADMIN_SECRET` remains optional, throttled, emergency-only recovery via Script Properties; the recovery session lives in browser memory only.

### Migration from the PIN system

Existing member IDs, progression, roles and achievements are preserved. On the first visit after the upgrade, a browser holding a still-valid legacy localStorage session exchanges it (`migrate` action) for a remembered-device cookie; the member’s backup code is generated if missing and shown once with “Please save this somewhere”, and the legacy storage is removed. A browser without a valid legacy session uses **Returning user** with the backup code — members without one contact an administrator, who generates or reveals it from the admin tools or the private sheet. PIN registration and login actions are removed from the API and UI; the dormant `PinSalt`/`PinHash` columns remain untouched for one release as rollback safety and may be cleared after live acceptance.

## Master Seal — Season 3

The exact end date for Season 3, “Echoes of Ember,” has not been formally announced. The currently published event and reward schedule extends through 19 August 2026, and the tracker states exactly that rather than presenting a confirmed end date or counting down to one. `MASTER_SEAL_SEASON.endsAt` is therefore `null` with `endDateAnnounced: false`; set both only if an end date is officially announced.

`MasterSeal.gs` defines the single authoritative season: six Chaotic Realm dungeons (Void - Towering Ruin, Void - Tina's Mindrealm, Cursed Radiant Tomb, Mech Facility, Mistveil Hunting Ground, Sea-Ringed Reef), a 3,650 maximum score and seven reward milestones (4 × 50 Rose Orbs, Avatar Frame, Namecard, and Mount: Neon Sonic at 3,650). Members record a best Master level (0–20 or Not cleared) and points per dungeon; no level-to-points formula is invented. The server derives every total: sum of the six point values, remaining (never below zero), progress (never above 100%), cleared count and mount unlock at exactly 3,650. Unknown dungeons, negative points, out-of-range levels and points on uncleared dungeons are rejected; identical updates write nothing.

The public board (`masterSeal` action) lists every active member — names only, no IDs — ranked by total score with all six dungeon values visible per row, search, sorting, filters, keyboard row selection and a detail panel with dungeon artwork and the reward track. Members edit only their own six dungeons through their session; administrators can correct any member with an audited action. Merging duplicates reassigns Master Seal rows to the kept member.

## Personal class & build selector

A signed-in member can record any number of unique class/build combinations from the selector beneath **My Progress**. They can add, remove, and reorder entries; selections are personal and do not alter progress data or guild rankings.

- **Canonical public definitions:** `data/classes.json` and `data/master-seal.json` are served by GitHub Pages and loaded once through `StaticData.js`. `Classes.gs` and `MasterSeal.gs` retain matching server-side validation constants; `npm run check:static-data` fails if they drift or if static JSON contains personal/security fields. Canonical roles are DPS (red), Tank (blue), and Healer (green). See [`docs/STATIC_DATA_MIGRATION.md`](docs/STATIC_DATA_MIGRATION.md) before editing these files.
- **Icons:** the nine white-glyph PNGs live in `assets/classes/<class-id>.png` (copied from the supplied `128.rar`; the `Profession_N.png → class` mapping is recorded explicitly in `data/classes.json`). They are displayed white-masked to the class colour via CSS `mask`, so the source assets are never recoloured.
- **Storage & API:** selections live in the additive `ClassSelections` sheet and are saved atomically through `saveClasses`. The API validates every class/build pair, rejects exact duplicates, and scopes every write to the signed-in member.
- **Guild Member CONFIG:** the Master Seal guild table projects the same saved selections in role order (DPS, Tank, Healer), while preserving the member's chosen order within each role.
- **Compatibility note:** legacy class rows remain readable; existing Master Seal / SV progress remains keyed to the member and is not re-keyed or lost.

## Raid difficulties: NM Raid and Easy/Hard Raid

**NM Raid = Nightmare Mode raid — NM never means Normal Mode.** The single "Raid" completion has been split into two independent booleans that are never combined internally or visually: `nmRaidCompleted` and `easyHardRaidCompleted`. Both appear as separate tick boxes in the Dungeon Difficulty controls and as two separate columns (**NM RAID**, **EASY/HARD RAID**) in the Guild Members table, each with the green ✓ / red × status (distinguished by glyph and label, not colour alone). Each resets independently on the weekly Monday 05:00 UTC‑2 boundary.

Storage stays on the Players sheet with new columns `NMRaidComplete`/`NMRaidDate` and `EHRaidComplete`/`EHRaidDate`. The legacy `RaidComplete`/`RaidDate` columns are kept only for a one-time, backward-compatible migration: on the next load or save, a completed legacy Raid becomes `easyHardRaidCompleted: true` (incomplete → `false`), `nmRaidCompleted` defaults to `false`, and the legacy column is cleared. Missing or invalid legacy values normalise to `false` and the migration is idempotent (`raidState_` in Code.gs; covered by `tests/backend/stim-floor.test.js`). New saves never write the combined field.

## Architecture: public code repo, private data repo, Sheets for secrets

- **Public code repo** `Daa13x/BPSR-Guild-Tracker` — the static site (GitHub Pages) plus the Apps Script `/exec` API source. Public class/season **definitions** load from versioned GitHub JSON (`data/manifest.json` → `data/classes.json`, `data/master-seal.json`) via `StaticData.js`, so the page never waits on the spreadsheet for those.
- **Private data repo** `Daa13x/BPSR-Guild-Tracker-Data` (private, branch `main`) — stores NON-PRIVATE tracker data under `state/`: `state/schema.json`, `state/manifest.json`, `state/board.json`, `state/members/<publicMemberId>.json`, and migration audit under `state/migration/`. Member files hold `schemaVersion, publicMemberId, characterName, profile, classes, stimVault, masterSeal, difficulty{easy,hard,master}, nmRaidCompleted, easyHardRaidCompleted, raidResetPeriod, stimVaultResetPeriod, updatedAt, dataRevision`. Scores/rankings are **always recomputed server-side** and never trusted from the browser.
- **Apps Script** is the only writer to GitHub; it holds the token. **Google Sheets keeps private data only**: accounts, sessions, session hashes, backup codes, login throttling, disabled state, admin roles, private audit, and the `privateMemberId → publicMemberId` map (`MemberMap`).

### Script Properties (secrets stay server-side)

`GITHUB_DATA_TOKEN`, `GITHUB_DATA_OWNER`, `GITHUB_DATA_REPO`, `GITHUB_DATA_BRANCH`, `GITHUB_DATA_PREFIX`, `GITHUB_DATA_MODE`. The token is read only at request time in `GitHubStore.gs` and is **never** returned, logged, put in an error message, committed, or exposed to the browser. Never place a real token or backup code in the repo or docs.

### Storage modes (`GITHUB_DATA_MODE`)

- **sheets** (default now) — the current system; nothing changes live. Migration tools can be previewed/executed/verified without switching.
- **shadow** — auth + the authoritative write stay in Sheets; each normal save is **also** mirrored to GitHub for comparison. A GitHub failure is surfaced (`shadowError`), never silently swallowed; normal data is never written *back* to Sheets from GitHub.
- **github** — all normal reads/writes use GitHub; Sheets serves only private auth/permission data (and the private id map). GitHub errors are shown honestly with **no Sheets fallback** for progression. There is a single source of truth.

Modes only change via an authenticated admin action; **github mode is refused until a verification has passed.**

### `GitHubStore.gs` safety

Writes restricted to `state/` (path traversal/escape rejected); every object scanned and private keys rejected before any network call; commits are one atomic git-data commit (blob→tree→commit→ref); the branch is updated with `force:false` so a newer commit is never clobbered; conflicts are detected and retried a bounded number of times, then surfaced as `GITHUB_CONFLICT`; the hot public cache is cleared after writes.

### Migration (admin-only, in the Administration → **GitHub Data Storage** panel)

`previewGithubMigration` (build from Sheets, strip private, validate, count, warn, mint a single-use confirm token — changes nothing) → `executeGithubMigration` (require the confirm token, re-check the source fingerprint hasn't changed, one atomic commit of the whole dataset) → `verifyGithubMigration` (read GitHub back, compare member count + approved fields + recomputed scores, scan for private fields, confirm legacy Raid became Easy/Hard only with NM defaulted false) → `switchGithubStorageMode` to shadow, then github. `getGithubStorageStatus` shows mode, repo, commit, schema, member count, and the last preview/execute/verify — never the token.

Legacy raid migration rule: **completed Raid → `easyHardRaidCompleted: true`; incomplete → `false`; `nmRaidCompleted` always defaults to `false`** and is never copied from the old combined field. Old `RaidComplete` Sheet columns are kept for rollback and no longer written.

### Rollback / token rotation

Rollback: set `GITHUB_DATA_MODE` back to `sheets` (Sheets data was never deleted) and redeploy is not required to read Sheets again. Token rotation/expiry: replace `GITHUB_DATA_TOKEN` in Script Properties; no code change and no redeploy of client code needed. If a token is revoked/expired, GitHub calls fail honestly (writes report an error; the UI does not claim success).

### Remaining `SpreadsheetApp` use (all private, required)

Accounts/sessions/backup codes/throttling/admin roles/audit in `AuthApi.gs` and `Code.gs`, plus the private `MemberMap` (id mapping) and `GithubMigration` (preview token + audit) in `Migration.gs`. In **github mode** none of the *progression* tables (`Players`, `MasterSeal`, class sheets) are read or written for normal saves; a test (`tests/backend/github-store.test.js`) fails if a normal github-mode action touches them.

> Live status: this code is committed and deployed to Pages, but **`GITHUB_DATA_MODE` is `sheets` and nothing has been migrated live.** Turning it on needs the owner to redeploy Apps Script (the code + token already exist in Script Properties), then run Preview → Execute → Verify → shadow → github from the admin panel. See "Enabling GitHub storage" below.

## Backend setup and redeployment

1. Back up the production spreadsheet and open **Extensions → Apps Script**.
2. Copy each backend file into the identically named Apps Script file: `Code.gs` → `Code.gs`, `AuthApi.gs` → `AuthApi.gs`, `MasterSeal.gs` → `MasterSeal.gs`, and `Classes.gs` → `Classes.gs`. Before saving, verify `Code.gs` begins with “Guild Leaderboard & Achievements” and contains `doGet`; pasting `MasterSeal.gs` into `Code.gs` removes the shared runtime and breaks every data action. `Leaderboard.html` is not required or served there: GitHub Pages hosts the interface, while Apps Script `/exec` hosts only the JSON API.
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

This confirms only that the deployed GET handler is reachable; it does not verify spreadsheet authorization, POST routing, authentication or Pages-origin behavior. After every deployment, run `npm run smoke:deployment -- <the /exec URL>` to verify the GET handler plus `activities`, `leaderboard`, `masterSeal`, and unknown-action POST routing. The tracker interface remains `https://daa13x.github.io/BPSR-Guild-Tracker/`. Public and protected API actions use JSON `POST` requests, and credentials or session tokens must never be placed in the URL.

## Configure the one API URL

`config.js` is the only frontend API configuration source, and its `configuredApiUrl` constant is the single sanctioned location for the production `/exec` URL. The committed constant is the live production deployment URL; after redeploying the Apps Script web app under a new URL, update only that constant:

```js
var configuredApiUrl = 'https://script.google.com/macros/s/.../exec';
```

A fresh fork may instead carry the documented `PASTE_APPS_SCRIPT_EXEC_URL_HERE` placeholder until its own deployment exists; `npm run check` accepts exactly those two forms and still rejects deployment URLs anywhere else in the repository. Do not invent an URL and do not place credentials in it. `BPSR_CONFIG.apiUrl` sends JSON `POST` requests for public leaderboard, member and administrator actions; direct browser navigation to the same URL is only the GET health diagnostic.

For one-browser setup, `?api=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2F...%2Fexec` is also accepted. Only an explicitly supplied, valid Apps Script `/exec` URL — or, for development only, a `localhost`/`127.0.0.1` `/exec` URL such as the one `scripts/dev-server.js` prints — is stored under `bpsrApiUrl`; invalid or unrelated URLs fail closed. A persisted explicit override outranks the committed constant on later visits, so clear the site’s `bpsrApiUrl` local storage to return to the production deployment. Editing the constant is the recommended shared Pages configuration.

The sidebar reports one of **Not configured**, **Connecting**, **Connected**, **Backend not deployed** (the deployment answers `UNKNOWN_ACTION` for the tracker actions), **Local API unavailable** / **API unreachable** (the `/exec` endpoint could not be reached), or **Backend request failed** (an unexpected server failure). Each state is also explained in full inside the boards; the raw backend response is written to the browser console only, never shown as the interface message. The preview notice appears only while no valid API URL is configured. The public leaderboard interface remains viewable, but registration and saving are unavailable until the backend is connected.

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
