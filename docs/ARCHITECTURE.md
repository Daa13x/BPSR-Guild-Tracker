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

1. Initial admin secret is stored only in Apps Script Script Properties.
2. Admin login returns a separate opaque expiring admin session.
3. Every admin action independently validates that session.
4. Frontend visibility is never treated as authorization.

## Public data

Leaderboard responses may include character name, validated progression, rank, timestamps intended for display, achievement summaries, and public feed entries.

They must not include emails, member IDs, hashes, salts, session data, admin data, spreadsheet IDs, or raw rows.

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

### Apps Script-hosted

The script may serve the frontend directly through `HtmlService`. A small transport adapter may use `google.script.run` only in this mode.

### GitHub Pages

The same frontend uses `fetch()` against the Apps Script JSON API. Transport details should be isolated so rendering and business UI are shared.

## Source visibility

The repository currently contains no secrets and must remain safe even if public. All runtime credentials and identifiers belong in Script Properties or local ignored configuration.
