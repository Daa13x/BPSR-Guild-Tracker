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
- Logout
- Reuse of invalidated session

## Authorization

- Member reads own profile
- Member updates own progress
- Member cannot update another member
- Anonymous and expired sessions rejected
- Non-admin cannot call admin actions

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

- Invalid and valid admin authentication
- Admin edit and delete
- Duplicate merge/removal
- Manual reset
- Achievement correction
- Audit record for every mutation
- Session invalidation after destructive identity changes

## API

- Valid GET and POST routes
- Unknown route
- Malformed JSON
- Invalid and oversized payload
- Safe machine-readable errors
- No stack trace or secret leakage

## Frontend

- Registration/login/update flows
- Tabs, search, and filters
- Admin controls and confirmations
- Loading/empty/error states
- Repeated-click prevention
- Expired session handling
- Keyboard navigation and focus
- Mobile-width rendering
- Long and HTML-like character names
- Missing or invalid API URL

## Honest reporting

Test reports must distinguish:

- automated tests actually executed
- syntax checks actually executed
- DOM/browser automation actually executed
- manual checks still required
- Google deployment checks not possible locally
