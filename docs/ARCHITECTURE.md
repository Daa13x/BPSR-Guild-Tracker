# Target architecture

## Production components

### Static frontend

- HTML, CSS, and vanilla JavaScript
- Can be served by GitHub Pages
- Contains no secrets
- Uses one configurable Google Apps Script `/exec` endpoint
- Calls the backend through `fetch()`

### Google Apps Script backend

- Routes `doGet` and `doPost` actions
- Validates all input server-side
- Owns authentication, authorization, totals, achievements, reset awards, and auditing
- Stores secrets in Script Properties
- Uses `LockService` where concurrent writes can affect fairness or uniqueness

### Google Sheets storage

Expected logical tables:

- Config
- Members
- MasterActivities
- MemberMasterProgress
- ProgressEvents
- AchievementHistory
- ResetPeriods
- AuditLog
- Sessions
- LoginAttempts or equivalent throttle storage

Stable IDs must be used instead of row numbers as permanent identity.

## Authentication

### Member

1. Member registers a normalized unique character name and PIN.
2. Backend creates a stable member ID, unique salt, and derived PIN hash.
3. Login returns an opaque expiring session token.
4. Every protected action validates the token server-side.
5. Logout, PIN change, member deletion, or expiry invalidates the session.

### Admin

1. `Players.IsAdmin` is authoritative and the corresponding `Members.MemberId` must equal `Players.UserId`.
2. An administrator signs in through the normal character-name/PIN flow.
3. The backend returns a separate opaque administrator session tied to that real member ID.
4. Every admin action independently validates the session, active member and live Players role.
5. Demotion revokes administrator sessions; disabling revokes all sessions for that member; logout revokes only its submitted token.
6. Atomic last-administrator checks prevent the final active administrator from being demoted, disabled or merged away.
7. `BPSR_ADMIN_SECRET`, when configured, is throttled emergency recovery only.
8. Frontend visibility is never treated as authorization.

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

The supported full frontend is published as static files through GitHub Pages and uses `fetch()` against the Apps Script JSON API. `config.js` is the sole API URL source. The backend may retain a legacy `doGet`, but repository assets such as `config.js` and `styles.css` are not automatically served by `HtmlService`; production UI instructions therefore target Pages.

## Source visibility

The repository currently contains no secrets and must remain safe even if public. All runtime credentials and identifiers belong in Script Properties or local ignored configuration.
