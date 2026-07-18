# Codex implementation task

Work only in `Daa13x/BPSR-Guild-Tracker` on branch `agent/complete-guild-tracker`.

## Inputs

The user will attach:

- `files.zip` containing Claude's existing `Code.gs`, `Leaderboard.html`, and `README.md`
- the real guild logo image

Treat those files as the baseline implementation. Preserve working leaderboard and achievement logic. Do not rebuild from scratch or switch frameworks.

## Required architecture

- Static HTML/CSS/vanilla JavaScript frontend
- Google Apps Script JSON API backend
- Google Sheets storage
- GitHub Pages-compatible frontend
- Apps Script-hosted frontend supported where practical
- No paid hosting
- No Node server in production
- Node may be used for tests only

## Required features

- Character-name and PIN registration/login
- Server-side salted PIN hashing
- Opaque expiring member sessions
- Failed-login throttling
- Secure admin sessions using Script Properties
- Members can edit only their own records
- SV floors 1–60
- Masters progression and server-calculated totals
- SV, Master Points, Master Completion, and Mount leaderboards
- First Guildie to Update with locked, genuine-event-only awarding
- First-to-achieve records and immutable achievement timestamps
- Recent progression feed
- Admin member editing, deletion, duplicate merge/removal, manual resets, audited corrections
- Responsive and accessible UI
- Loading, empty, validation, network, and error states

## Branding

Use the supplied guild name/logo and:

- `#4C3945`
- `#260D19`
- `#D9D9D9`
- `#D9BFCB`
- `#261D21`

Remove temporary oxblood/brass/demo branding.

## Security

Never commit or expose PINs, PIN hashes, salts, admin secrets, spreadsheet IDs, private member IDs, raw sheet rows, or internal errors. Never trust browser totals. Validate authentication and authorization on every protected backend operation. Escape user-controlled text and prevent spreadsheet formula injection.

## Testing

Create a mocked Apps Script runtime and automated tests for registration, authentication, session expiry, authorization, SV boundaries, Masters validation, idempotent updates, ranking, tie-breaking, first-updater concurrency behaviour, achievements, public payload privacy, admin actions, auditing, and safe API errors.

Run syntax checks and frontend tests where possible. Do not claim real deployment or mobile testing unless actually performed.

## Documentation

Replace the baseline README with accurate documentation covering architecture, file tree, security limitations, sheet schema, Script Properties, Apps Script deployment, GitHub Pages deployment, configuration, tests, troubleshooting, backups, and upgrades.

## Delivery

Commit and push all work to `agent/complete-guild-tracker`, then open a draft PR to `main`. Do not merge.

Return implementation summary, changed files, architecture, exact tests/results, security review, deployment steps, manual configuration, limitations, and PR URL.
