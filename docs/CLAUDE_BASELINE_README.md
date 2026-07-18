# Guild Leaderboard & Achievements

Standalone implementation of the leaderboard spec, built on **Google Apps Script + Google Sheets**.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Server: sheets, validation, leaderboards, achievements, reset periods, caching |
| `Leaderboard.html` | The responsive leaderboard page (also previews in a browser with sample data) |

## Setup (about 5 minutes)

1. Create a Google Sheet, then **Extensions → Apps Script**.
2. Replace the default `Code.gs` with the one here; add an HTML file named
   `Leaderboard` and paste in `Leaderboard.html`.
3. In the editor, run **`setupSpreadsheet`** once and grant permissions.
   This creates every sheet with headers, seeds the Config defaults, seeds
   5 example Master activities, and opens the first reset period.
4. Edit the **MasterActivities** sheet with your real activity names,
   max ranks and Active flags.
5. In **Config**, set `ADMIN_EMAILS` to a comma-separated list of admin
   Google accounts.
6. **Deploy → New deployment → Web app**, *Execute as: user accessing the
   web app*, access as appropriate for your guild. Share the URL.
7. In the spreadsheet, protect `AchievementHistory`, `ProgressEvents`,
   `ResetPeriods` and `AuditLog` (Data → Protect sheet) so only the owner
   can edit — normal users must never edit these directly.

You can double-click `Leaderboard.html` right now to preview the design
with sample data before deploying.

## Assumptions made (standalone build)

- **Identity**: the signed-in Google account email is the internal user ID.
  It is stored in the sheets but **never** included in any payload sent to
  the browser — only character-name snapshots are public.
- **Guild colours**: unknown, so the entire theme lives in one CSS
  variable block at the top of `Leaderboard.html` (oxblood + brass by
  default). Change ~10 hex values to rebrand.
- **Master model**: each activity has ranks M1…MaxRank (default 20); the
  sheet stores each player's highest completed rank per activity.
- **"Effective" Master points** = the server-stored validated total (no
  cap or formula applied; adjust `buildBundle_` if your game differs).
- An **update dialog** is included so the page is usable standalone; the
  server diffs every submission against the stored record, so the page
  never submits totals the server trusts blindly.
- The spec references an audit log, so an `AuditLog` sheet is created for
  admin corrections and manual resets.

## How the spec maps to the code

- **Server-validated totals** — `submitProgress()` is the only write path.
  It clamps values, ignores decreases where only increases are valid,
  diffs against the stored row, and writes events only for genuine change.
- **SV / Master Points / Master Completion boards** — sorted exactly per
  spec (value → earliest achievement date → name) in `buildBundle_`.
- **Mount Hall of Fame** — driven by immutable `MOUNT_EARNED` rows in
  AchievementHistory, ordered by first earned; later score edits never
  touch the original timestamp, position or points-when-earned.
- **First Guildie to Update** — awarded inside a script lock to the first
  valid event of the active period. Logins, note edits, name changes,
  identical re-saves and (by default) registrations never count.
  Configurable via Config keys; admin button starts a period manually;
  historical winners are never deleted.
- **First-to-achieve records** — `maybeFirst_()` writes each record once,
  server-side, at the moment it first occurs. Only
  `correctAchievement()` (admin-only, audit-logged) can amend one.
- **Recent guild progress** — public, valid events only; togglable with
  `ACTIVITY_FEED_ENABLED`; no usernames, emails or IDs are ever exposed.
- **Fairness** — last-updated shown per player, configurable "outdated"
  badge (`OUTDATED_DAYS`), no penalties or deletions for inactivity,
  filters (active / outdated / mount / SV complete), name search, top-3
  podium above the full table. No combined overall score unless
  `OVERALL_SCORE_ENABLED` is set to true and a formula is configured.
- **Performance** — batched full-range reads (no per-row scans), one
  server call returns every board, results cached in `CacheService`
  (default 90 s, configurable), cache cleared after valid progression
  changes, stable UUID-based user/event/achievement IDs, script lock +
  server-side diffing prevents duplicate achievement events.

## Config reference (Config sheet)

| Key | Default | Meaning |
|---|---|---|
| `MOUNT_TARGET` | 3650 | Points needed for the mount |
| `OUTDATED_DAYS` | 14 | Days before the "outdated" badge shows |
| `RESET_FREQUENCY` | weekly | weekly / monthly / seasonal / manual |
| `RESET_DAY` | Monday | Weekly reset day |
| `RESET_TIME` | 06:00 | Reset time (HH:mm) |
| `RESET_TIMEZONE` | Europe/London | Time zone for resets |
| `REGISTRATION_COUNTS` | false | Whether registering counts as an update |
| `ADMINS_ELIGIBLE` | true | Whether admins can win the badge |
| `FIRST_UPDATER_PUBLIC` | true | Show the winner publicly |
| `FIRST_UPDATER_ENABLED` | true | Feature toggle |
| `ACTIVITY_FEED_ENABLED` | true | Recent progress feed toggle |
| `OVERALL_SCORE_ENABLED` | false | Combined score (off unless enabled) |
| `ADMIN_EMAILS` | — | Comma-separated admin emails |
| `CUSTOM_MILESTONES` | `[]` | JSON list, e.g. `[{"id":"MP1000","label":"1,000 pts","type":"points","value":1000}]` |
| `CACHE_SECONDS` | 90 | Public leaderboard cache TTL |
