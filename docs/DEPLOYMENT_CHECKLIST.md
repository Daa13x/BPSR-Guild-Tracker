# Deployment checklist

## Google Sheet and stable identities

- [ ] Back up the production spreadsheet before setup, migration, merge or role work.
- [ ] Open **Extensions → Apps Script** and add the final `Code.gs` and `AuthApi.gs`.
- [ ] Run the idempotent `setupSpreadsheet()` function and confirm no demo members were inserted.
- [ ] Confirm all required sheets and exact headers exist.
- [ ] Confirm each `Members.MemberId` maps to exactly one `Players.UserId`; resolve missing or duplicate mappings before deployment.
- [ ] Confirm Dax’s `Members.MemberId` equals Dax’s `Players.UserId` and that exact Players row has `IsAdmin=TRUE`.
- [ ] Confirm Dax uses the existing normal member PIN flow; do not create or document a default PIN.
- [ ] Configure real Master activities, active states and maximum ranks.
- [ ] Review `Config`, including Europe/London timezone and reset settings.
- [ ] Protect member-authentication, session, throttle, event, achievement, reset and audit sheets as appropriate.

## Script Properties and recovery

- [ ] Decide whether emergency recovery is required. Normal administration does not require `BPSR_ADMIN_SECRET`.
- [ ] If retained, set a long random `BPSR_ADMIN_SECRET` in Apps Script Script Properties only.
- [ ] Confirm no secret, PIN, hash, salt, token, spreadsheet ID or deployment credential exists in Git or a public sheet cell.
- [ ] Record the emergency access, rotation and recovery process privately.

## Apps Script deployment

- [ ] Deploy a **new version** of the web app after copying backend changes; saving source alone does not update `/exec`.
- [ ] Use the execute-as and access options appropriate to the production spreadsheet and intended guild members.
- [ ] Copy the final HTTPS URL ending in `/exec` without adding credentials.
- [ ] From the live Pages origin, test the public leaderboard POST and confirm CORS/redirect behavior.
- [ ] Test normal registration, login, own profile, SV update, Master update, identical update and member logout.
- [ ] Test session restoration, 12-hour expiry behavior and five-failure/15-minute throttling.
- [ ] Confirm browser-supplied totals are ignored and server-calculated totals are returned.
- [ ] Confirm malformed, oversized and unknown requests return safe JSON errors with no stack trace.

## Member-based administrator verification

- [ ] Sign in as Dax through the normal character-name/PIN form and confirm the Administrator badge and protected view appear.
- [ ] Confirm an ordinary member cannot call any administrator action, even if browser controls are manually exposed.
- [ ] Promote a registered test member and confirm the audit entry identifies the acting member ID.
- [ ] Sign in or refresh that member and confirm a member-bound administrator session is issued.
- [ ] With at least two active administrators, demote the test administrator and confirm all of their administrator sessions fail immediately while member sessions remain valid.
- [ ] Confirm self-demotion requires the stronger warning and explicit confirmation.
- [ ] Confirm the final active administrator cannot be demoted, disabled or removed/merged away.
- [ ] Disable a test member and confirm all of that member’s sessions are revoked; re-enable only after verifying intent.
- [ ] Confirm member logout revokes only the submitted member token and administrator logout revokes only the submitted administrator token.
- [ ] Exercise member edit, duplicate keep/remove merge, achievement correction, manual reset and audit-log viewing.
- [ ] Confirm every administrative mutation appears in `AuditLog` with the authenticated actor’s stable ID.
- [ ] If configured, test emergency recovery separately and confirm failed attempts are throttled. Do not use it for routine sign-in.

## One frontend API configuration

- [ ] In `config.js`, replace only `PASTE_APPS_SCRIPT_EXEC_URL_HERE` with the real `/exec` URL, or explicitly use `?api=...` for one-browser setup.
- [ ] Confirm `Leaderboard.html` and `AppFrontend.js` both use `window.BPSR_CONFIG`; no legacy `APP_CONFIG`, direct totals submission or second URL store remains.
- [ ] If a stale deployment was previously supplied, clear the site’s `bpsrApiUrl` local-storage value/site data.
- [ ] With no URL, confirm **Not configured** and the preview notice; member/admin writes must explain that saving is unavailable.
- [ ] With the real URL, confirm **Connecting**, then **Connected**, and confirm the preview notice stays hidden.
- [ ] Simulate a bad/network-failing deployment and confirm **API error** plus readable member/admin scoped errors.

## GitHub Pages and visual checks

- [ ] Confirm repository **Settings → Pages → Source** is **GitHub Actions**.
- [ ] Confirm `.github/workflows/pages.yml` publishes the repository root and the latest run succeeds.
- [ ] Open `https://daa13x.github.io/BPSR-Guild-Tracker/` and confirm `index.html` opens `Leaderboard.html` while retaining query/hash values.
- [ ] Confirm `config.js`, `styles.css`, `AppFrontend.js`, favicon and `assets/guild-logo.png` load beneath `/BPSR-Guild-Tracker/`; no asset assumes `/` hosting.
- [ ] Confirm the supplied transparent OnlyPaws logo is not stretched and its text fallback appears if the image request is blocked.
- [ ] Test desktop sidebar and narrow/mobile top navigation, including horizontal navigation scrolling.
- [ ] Test keyboard focus, leaderboard arrow-key tabs, form labels, status announcements and reduced-motion behavior.
- [ ] Test public empty, loading, search/filter, network-error and API-error states.
- [ ] Test registration, progression, role and destructive confirmations from the deployed origin.
- [ ] Confirm hostile-looking character names render as text rather than HTML.

## Security and release record

- [ ] Run `npm test`, `npm run check`, and `git diff --check` against the release commit.
- [ ] Search current files and Git history for secrets and real deployment URLs before publication.
- [ ] Inspect public leaderboard and authenticated profile payloads for private fields.
- [ ] Confirm PINs and session tokens are never logged, placed in URLs or rendered into the DOM.
- [ ] Record the Git commit SHA, Apps Script deployment version, workflow run, spreadsheet owner, backup location, live-test results and date privately.
- [ ] Keep rollback instructions: redeploy the prior Apps Script version, revert Pages to a verified commit and restore a verified Sheet backup if data repair is required.
