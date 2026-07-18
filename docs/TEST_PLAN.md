# Test plan

Automated tests must exercise the real backend implementation through a mocked Google Apps Script runtime rather than duplicating business logic in a separate model.

## Authentication

- Valid registration
- Normalized duplicate name
- Invalid name and PIN
- Valid login
- Incorrect PIN
- Unknown account
- Failed-login throttling
- Session expiry
- Member-token logout isolation
- Reuse of invalidated session

## Authorization

- Member reads own profile
- Member updates own progress
- Member cannot update another member
- Anonymous and expired sessions rejected
- Non-admin cannot call admin actions
- Normal IsAdmin member receives a member-bound admin session
- Live role recheck rejects stale/demoted admin sessions

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

## Administration

- Normal administrator member login and optional recovery authentication
- Profile/list/details return `isAdmin` without authentication material
- Promotion, fresh-login-issued access, role-only member refresh, repeated-refresh row stability, demotion and demotion-session revocation
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

- Valid GET and POST routes
- Unknown route
- Malformed JSON
- Invalid and oversized payload
- Safe machine-readable errors
- No stack trace or secret leakage

## Frontend

- Registration/login/update flows
- Normal administrator login and role-state restoration
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
