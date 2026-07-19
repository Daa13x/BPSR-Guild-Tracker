# Test plan

Automated tests must exercise the real backend implementation through a mocked Google Apps Script runtime rather than duplicating business logic in a separate model.

## Accounts

- Valid name-only account creation with generated backup code
- Normalized duplicate name rejected and routed to restore
- Invalid character name rejected
- Restore with correct code (case- and separator-insensitive)
- Incorrect code and unknown account return the same generic failure
- Failed-restore throttling
- Remembered-device session default and configured lifetimes
- Session expiry
- Member-token logout isolation and revoke-all-devices
- Reuse of invalidated session
- Legacy-session migration preserving IDs, data and roles; code generated when missing
- Own-code access through a valid session only
- PIN register/login actions removed

## Authorization

- Member reads own profile
- Member updates own progress
- Member cannot update another member
- Anonymous and expired sessions rejected
- Non-admin cannot call admin actions (including code reveal/regenerate/revoke)
- IsAdmin member session authorizes admin actions directly with a live role recheck per action
- Demoted or disabled members lose admin access immediately

## Progress

- SV floors 1 and 60 accepted
- SV below 1, above 60, non-integer, NaN, and infinity rejected
- Valid Masters update
- Unknown/inactive activity rejected
- Rank above configured maximum rejected
- Identical update produces no event
- Genuine update produces one event
- Client-supplied totals ignored

## Ranking and achievements

- Correct sorting
- Deterministic ties
- Master total computed server-side
- First Guildie awarded once
- Registration excluded by default
- Achievement recorded once
- Mount timestamp and position immutable
- Public payload privacy

## Master Seal

- Exact Season 3 configuration (six dungeon IDs/names, 3,650 maximum, seven rewards)
- Own-member six-dungeon update with server-derived totals
- Partial updates touch only submitted dungeons; identical updates change nothing
- Mount unlocks at exactly 3,650; remaining clamps at zero; progress clamps at 100%
- Unknown dungeons, negative/oversized points, invalid levels, non-boolean cleared and points-on-uncleared rejected
- Public board ranks by total, includes zero-progress members, hides member IDs
- Admin correction audited; non-admin correction rejected
- Merge reassigns seal rows

## Administration

- Recovery authentication and member-session admin access
- Profile/list/details return `isAdmin` and recovery metadata without authentication material
- Backup-code reveal, regenerate (old code invalidated, optional device revocation) and device revocation, audited without codes
- Promotion, refresh row stability, demotion taking effect immediately
- Strict boolean role/disabled payload validation
- Self-demotion confirmation and last-active-admin demote/disable/merge protection
- Admin edit and delete
- Duplicate merge/removal
- Manual reset
- Achievement correction
- Authenticated actor ID in the audit record for every mutation
- Session invalidation after destructive identity changes
- Administrator-token logout isolation
- Stable Members-to-Players identity mismatch fails closed

## API

- GET health route returns the exact safe JSON fields without invoking `HtmlService` or exposing private data
- POST routes preserve the public and protected action envelopes
- Unknown route
- Malformed JSON
- Invalid and oversized payload
- Safe machine-readable errors
- No stack trace or secret leakage

## Frontend

- First-visit Who are you? gate with both visible paths and no PIN
- Account creation, one-time backup-code panel, compact reveal/copy control
- Cookie holds only the opaque token; restore, refresh restoration, migration
- Master Seal board rendering, member editing and escaping
- Tabs, search, and filters
- Selected-member details/edit/role/disable controls and confirmations
- Duplicate keep/remove choice and confirmed merge payload
- Achievement-correction, reset and audit-list rendering
- Loading/empty/error states
- Repeated-click prevention
- Member/admin expired-session cleanup in the correct interface
- Member/admin logout isolation
- Keyboard navigation and focus
- Mobile-width rendering
- Long and HTML-like character names
- Unified query/constant/stored API configuration and preview notice state
- Missing, invalid, or storage-denied API configuration

## Honest reporting

Test reports must distinguish:

- automated tests actually executed
- syntax checks actually executed
- DOM/browser automation actually executed
- manual checks still required
- Google deployment checks not possible locally
