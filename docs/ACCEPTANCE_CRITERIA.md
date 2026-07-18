# Acceptance criteria

## Registration and login

- Unique character name comparison is normalized and duplicate-safe.
- Invalid and blank names are rejected.
- PIN policy is enforced.
- Plaintext PINs are never stored or logged.
- Login errors do not reveal whether an account exists.
- Repeated failures are throttled.
- Member sessions are opaque, expiring, revocable, and validated server-side.
- Logout invalidates only the submitted session; disabling an account invalidates all of that member’s sessions.

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

- `Players.IsAdmin` is authoritative and `Members.MemberId` maps exactly to `Players.UserId`.
- Administrators use normal character-name/PIN login and receive a separate member-bound admin session.
- An optional recovery secret is not committed or returned and is not the normal sign-in path.
- Every admin operation rechecks the session, active member and live role server-side.
- Admin can list/search, edit, enable/disable, promote/demote, merge duplicates, reset periods, correct achievements, view audit entries, and log out.
- Demotion immediately revokes the target’s admin sessions; disable revokes all target sessions.
- The last active administrator cannot be demoted, disabled or merged away.
- Self-demotion requires an explicit stronger confirmation.
- Member and administrator logout do not revoke unrelated sessions.
- Destructive actions require confirmation.
- Every administrative mutation is audited with the authenticated actor’s stable ID.

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
- Optional emergency Script Properties are documented.
- GitHub Pages deployment instructions match the final repository-relative frontend.
- GitHub Pages requires no build process.
- Real deployment checks still needed are clearly disclosed.
