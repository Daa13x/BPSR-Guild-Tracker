# Acceptance criteria

## Accounts: creation and restore

- A fresh browser shows Who are you? with New user and Returning user both visible.
- A new unique character name creates one member and one linked player record; no PIN or password exists in the active flow.
- Unique character name comparison is normalized and duplicate-safe; duplicates route to the returning flow.
- Invalid and blank names are rejected.
- A strong random backup code is generated, shown once with “Please save this somewhere”, and stored only in the private Members sheet.
- The remembered-device cookie holds only the opaque session token; refresh restores the account without a prompt.
- Restore requires character name plus backup code (case- and separator-insensitive); errors do not reveal whether an account exists.
- Repeated restore failures are throttled.
- Member sessions are opaque, long-lived (configurable), revocable, and validated server-side; only token hashes are stored.
- Sign-out invalidates only the submitted session; revoke-all ends every device; disabling an account invalidates all of that member’s sessions.
- A valid legacy PIN-era session migrates once to the cookie, preserving member ID, progression and role, and generating a missing code.
- Backup codes never appear in public payloads, URLs, logs or audit details; admins can reveal, copy and regenerate them with auditing, and regeneration kills the old code immediately.

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

## Master Seal — Season 3

- One authoritative season configuration: six exact dungeons, 3,650 maximum, seven reward milestones ending in Mount: Neon Sonic.
- Members record best Master level (0–20 or Not cleared) and points per dungeon; no level-to-points formula is invented.
- Total is the server-side sum of the six point values; remaining never goes below zero; progress never exceeds 100%; the mount unlocks at exactly 3,650.
- Unknown dungeons, invalid levels, negative points and points on uncleared dungeons are rejected; missing data contributes zero; identical updates change nothing.
- The board shows every active member with all six dungeon values per row, search/sort/filters, keyboard selection, a detail panel with artwork, and the reward track with earned/next/locked states.
- Members edit only their own six dungeons; admin corrections are audited; merges reassign seal records.

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
- Administrator access is the member’s own remembered-device session; no admin flag is trusted from a cookie.
- An optional recovery secret is not committed or returned and is not the normal sign-in path.
- Every admin operation rechecks the session, active member and live role server-side.
- Admin can list/search (with backup-code status, last access and device counts), edit/rename, enable/disable, promote/demote, reveal/copy/regenerate backup codes, revoke devices, merge duplicates, reset periods, correct achievements, view audit entries, and log out.
- Demotion immediately ends the target’s admin authority; disable revokes all target sessions.
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
