# Target architecture

## Production components

### Static frontend

- HTML, CSS, and vanilla JavaScript
- Can be served by GitHub Pages
- Contains no secrets
- Uses one configurable Google Apps Script `/exec` endpoint
- Calls the backend through `fetch()`

### Google Apps Script backend

- Returns a static, side-effect-free JSON health response from `doGet`
- Routes public and protected JSON actions through `doPost`
- Validates all input server-side
- Owns authentication, authorization, totals, achievements, reset awards, and auditing
- Stores secrets in Script Properties
- Uses `LockService` where concurrent writes can affect fairness or uniqueness

### Google Sheets storage

Expected logical tables:

- Config
- Members (includes readable backup codes and access metadata — must stay private)
- MasterActivities
- MemberMasterProgress
- MasterSeal (MemberId, DungeonId, BestMasterLevel, Points, Cleared, UpdatedAt)
- ProgressEvents
- AchievementHistory
- ResetPeriods
- AuditLog
- Sessions (token hashes only, with kind, expiry, revocation and last use)
- LoginAttempts or equivalent throttle storage

Stable IDs must be used instead of row numbers as permanent identity.

## Authentication — passwordless remembered devices

### Member

1. A new member submits only a normalized unique character name.
2. Backend creates a stable member ID, the linked player row, and a strong random `BPSR-XXXX-XXXX-XXXX` backup code stored readable in the private Members sheet (explicit trusted-guild product decision).
3. Backend issues a long-lived opaque remembered-device session (default 180 days, `MEMBER_SESSION_DAYS`); only the token hash is stored.
4. The browser keeps only the opaque token in a first-party, path-scoped cookie (`__Secure-` prefixed on HTTPS) and sends it in the JSON POST body. The cookie never holds names, IDs, codes, roles or progression.
5. A returning browser without the cookie restores access with character name + backup code; failures are generic and throttled.
6. Every protected action validates the token server-side; sign-out revokes one token, revoke-all revokes every device, disabling revokes all sessions.
7. A still-valid legacy PIN-era session can be exchanged once (`migrate`) for a remembered-device session; the backup code is generated if missing and shown once. PIN authentication is removed; dormant PinSalt/PinHash columns remain one release for rollback only.

### Admin

1. `Players.IsAdmin` is authoritative and the corresponding `Members.MemberId` must equal `Players.UserId`.
2. Administrator access is the member's own remembered-device session: every admin action validates the session **and** rechecks the live role — no separate admin credential and no trust in any browser flag.
3. Demotion or disabling therefore takes effect on the next request; disabling also revokes all sessions; logout revokes only its submitted token.
4. Atomic last-administrator checks prevent the final active administrator from being demoted, disabled or merged away.
5. Administrators can reveal, copy and regenerate member backup codes and revoke member devices; reveals and changes are audited without writing codes into the log.
6. `BPSR_ADMIN_SECRET`, when configured, is throttled emergency recovery only; its session lives in browser memory.
7. Frontend visibility is never treated as authorization.

## Master Seal

`MasterSeal.gs` owns one authoritative Season 3 configuration (six exact dungeons, 3,650 maximum, seven reward milestones ending in Mount: Neon Sonic). Members write only their own six per-dungeon records (best Master level 0–20 or not cleared, points, cleared flag); the server validates every value, rejects unknown dungeons and points on uncleared dungeons, and derives total, remaining (≥0), progress (≤100%), cleared count and the 3,650 mount unlock. The public board projects names only. Duplicate merges reassign seal rows.

## Public data

Leaderboard responses may include character name, validated progression, rank, timestamps intended for display, achievement summaries, and public feed entries.

Public leaderboard payloads must not include emails, member IDs, hashes, salts, session data, admin data, spreadsheet IDs, or raw rows. A member’s protected own-profile response may include that member’s stable ID and `isAdmin`, but no authentication material.

## Progression flow

1. Browser submits only the desired atomic progression values.
2. Backend validates types, integer ranges, activity existence, rank limits, and ownership.
3. Backend reads stored values and calculates genuine changes.
4. Identical submissions produce no event.
5. Backend writes validated state and events.
6. Backend evaluates achievements and First Guildie under locks.
7. Backend clears leaderboard caches.
8. Backend returns a safe response.

## Deployment modes

### GitHub Pages

The supported full frontend is published as static files through GitHub Pages and uses `fetch()` against the Apps Script JSON API. `config.js` is the sole API URL source. Apps Script `GET /exec` returns only the static health JSON; it does not use `HtmlService` or serve the frontend. Public and protected actions use JSON `POST /exec` requests.

## Source visibility

The repository currently contains no secrets and must remain safe even if public. All runtime credentials and identifiers belong in Script Properties or local ignored configuration.
