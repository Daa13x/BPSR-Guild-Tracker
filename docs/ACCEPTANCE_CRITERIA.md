# Acceptance criteria

## Registration and login

- Unique character name comparison is normalized and duplicate-safe.
- Invalid and blank names are rejected.
- PIN policy is enforced.
- Plaintext PINs are never stored or logged.
- Login errors do not reveal whether an account exists.
- Repeated failures are throttled.
- Member sessions are opaque, expiring, revocable, and validated server-side.
- Logout and deleted accounts invalidate sessions.

## Member permissions

- A member can read their private profile.
- A member can update only their own progress.
- Anonymous, expired, and cross-member writes are rejected.

## Progress validation

- SV floor 1 is accepted.
- SV floor 60 is accepted.
- Values below 1, above 60, non-integers, NaN, and infinity are rejected.
- Masters activities must exist and be active.
- Masters ranks must be integers within the configured maximum.
- Totals are calculated from validated records on the server.
- Identical resubmissions create no progression event.
- Genuine updates create exactly one appropriate event.
- Registration, login, logout, notes, and profile formatting do not count as progression by default.

## Leaderboards

- SV, Master Points, Master Completion, and Mount Hall of Fame boards render.
- Ranking and tie-breaking are deterministic.
- Top-three podium and full rankings agree.
- Search and all filters work.
- Outdated status uses configured threshold without deleting or penalising users.
- Public payloads contain no private authentication or identity fields.

## First Guildie to Update

- Awarded only for the first genuine valid progression event in an active period.
- Award operation is protected by a script lock.
- Concurrent-equivalent requests cannot create two winners.
- Registration is excluded unless explicitly configured.
- Historical winners are preserved.
- Weekly, monthly, seasonal, and manual reset modes are supported.
- Default timezone is Europe/London.

## Achievements

- First-to-achieve and mount records are generated server-side.
- Each achievement is recorded once.
- Original earned timestamps and positions remain immutable.
- Corrections require admin authorisation and create audit entries.
- Removing or merging a member does not silently destroy historical attribution.

## Admin

- Admin secret is not committed or returned to the frontend.
- Admin login creates a separate server-validated session.
- Every admin operation verifies that session.
- Admin can list/search, edit, delete, merge duplicates, reset periods, correct achievements, and log out.
- Destructive actions require confirmation.
- Every administrative mutation is audited.

## Frontend

- Responsive desktop and mobile layouts.
- Keyboard operable controls and visible focus states.
- Accessible labels for forms and buttons.
- Safe rendering of HTML-like names.
- Useful loading, empty, validation, network, and API error states.
- Buttons prevent accidental repeated submissions.
- Missing API configuration is detected and explained.
- Expired sessions are cleared automatically.

## Setup and deployment

- Spreadsheet setup is idempotent and non-destructive.
- Demo members are never seeded automatically.
- Required Script Properties are documented.
- Apps Script-hosted and GitHub Pages deployment instructions match the final code.
- GitHub Pages requires no build process.
- Real deployment checks still needed are clearly disclosed.
