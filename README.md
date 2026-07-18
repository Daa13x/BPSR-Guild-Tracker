# BPSR Guild Tracker

Build-free guild progression tracker for Google Sheets, Google Apps Script and GitHub Pages. It preserves the imported Claude leaderboard, achievement, event, reset-period, cache and audit implementation, with an added JSON API identity layer for character-name and PIN registration/login.

## Architecture

`Leaderboard.html` is static HTML/CSS/vanilla JS. `Code.gs` owns the Sheets schema, progression validation, rankings, achievements, reset periods, caching and audit trail. `AuthApi.gs` supplies `/exec` JSON routes and stores salted PIN derivations, opaque token hashes, and throttle state in private sheets. No production Node server is used.

```
Code.gs                 domain, sheets, rankings, events, achievements
AuthApi.gs              JSON API, PIN/session/throttle helpers
Leaderboard.html        GitHub Pages-compatible UI
assets/                 real guild logo (add assets/guild-logo.png)
tests/                  Node test tooling
```

## Security and limitations

PINs are never written to Sheets or returned by the API; a unique server salt plus SHA-256 derivation is stored instead. API errors are generic, sessions expire after 12 hours and are revocable, and five failed logins are throttled for 15 minutes. Names are normalized for duplicate detection and protected from formulas/HTML. Character name + PIN is appropriate only for a small guild, not high-security identity verification. Configure `BPSR_ADMIN_SECRET` as a Script Property; never commit it. Google Apps Script/Sheets access controls and actual browser CORS behaviour require deployment testing.

## Setup

1. Create a Google Sheet and Apps Script project, then copy `Code.gs`, `AuthApi.gs`, and `Leaderboard.html`.
2. Run `setupSpreadsheet()` once. It is idempotent and does not add demo members.
3. Set Script Property `BPSR_ADMIN_SECRET` to a long, random secret. If using a standalone script, set its spreadsheet binding/ID through Apps Script configuration rather than Git.
4. Edit `MasterActivities`, review `Config`, and protect `Members`, `Sessions`, `LoginAttempts`, events, achievements, resets and audit sheets.
5. Deploy as a web app and copy the `/exec` URL. Configure it in the frontend deployment configuration; do not embed credentials.

## Sheets

`Config`, `Players`, `MasterActivities`, `MasterProgress`, `ProgressEvents`, `AchievementHistory`, `ResetPeriods`, and `AuditLog` preserve the baseline domain model. `Members`, `Sessions`, and `LoginAttempts` are private authentication tables. Stable IDs—not row numbers—identify records.

## GitHub Pages

Publish the root folder, add the supplied real logo as `assets/guild-logo.png`, and set the Apps Script `/exec` endpoint in the documented frontend configuration. Pages contains only public assets. Test the deployed origin for CORS, registration, login, logout, expiration, member updates and administrator actions.

## Operations

Admins use the separate Script-Property-backed session. Administrative corrections and reset actions must be audited; back up the spreadsheet before deletes/merges and record the deployment version and commit SHA privately. For rollback, redeploy the prior Apps Script version and restore a verified Sheet backup.

## Validation

Run `npm test` and `npm run check`. Local checks cannot validate a real Apps Script deployment, Google authorization, protected-sheet permissions, browser/mobile behaviour, or cross-origin requests; complete the checklists in `docs/DEPLOYMENT_CHECKLIST.md` before release.
