# Deployment checklist

## Google Sheet and stable identities

- [ ] Back up the production spreadsheet before setup, migration, merge or role work.
- [ ] Open **Extensions → Apps Script** and add the final `Code.gs`, `AuthApi.gs` and `MasterSeal.gs`.
- [ ] Run the idempotent `setupSpreadsheet()` function and confirm no demo members were inserted.
- [ ] Confirm all required sheets and exact headers exist, including the appended `Members` columns (`BackupCode`, `BackupCodeCreatedAt`, `BackupCodeUpdatedAt`, `LastAccessAt`), `Sessions.LastUsedAt` and the new `MasterSeal` sheet, with all existing data intact.
- [ ] Confirm each `Members.MemberId` maps to exactly one `Players.UserId`; resolve missing or duplicate mappings before deployment.
- [ ] Confirm Dax’s `Members.MemberId` equals Dax’s `Players.UserId` and that exact Players row has `IsAdmin=TRUE`.
- [ ] Confirm no default backup code is created or documented anywhere; codes are generated per member.
- [ ] Configure real Master activities, active states and maximum ranks.
- [ ] Review `Config`, including Europe/London timezone, reset settings and `MEMBER_SESSION_DAYS`.
- [ ] Protect the `Members` (now holding readable backup codes), `Sessions`, `LoginAttempts`, `MasterSeal`, event, achievement, reset and audit sheets; restrict spreadsheet editors to trusted administrators and record that editors can read codes and impersonate members.

## Script Properties and recovery

- [ ] Decide whether emergency recovery is required. Normal administration does not require `BPSR_ADMIN_SECRET`.
- [ ] If retained, set a long random `BPSR_ADMIN_SECRET` in Apps Script Script Properties only.
- [ ] Confirm no secret, PIN, hash, salt, token, spreadsheet ID or deployment credential exists in Git or a public sheet cell.
- [ ] Record the emergency access, rotation and recovery process privately.

## Apps Script deployment

- [ ] Confirm GitHub Pages hosts the interface; `Leaderboard.html` is not required or served by the Apps Script endpoint.
- [ ] Deploy a **new version** of the web app after copying backend changes; saving source alone does not update `/exec`.
- [ ] Use the execute-as and access options appropriate to the production spreadsheet and intended guild members.
- [ ] Copy the final HTTPS URL ending in `/exec` without adding credentials.
- [ ] Open `/exec` directly and confirm the `GET` health response is JSON with `ok: true` and `status: "ready"`.
- [ ] Confirm the health payload contains only the four static `ok`, `service`, `status` and `message` fields, with no Sheet, member, administrator or session data.
- [ ] Treat the health response as a reachability check only; it does not replace live POST, authorization, redirect or Pages-origin verification.
- [ ] Confirm public and protected API operations use JSON `POST` requests; never place backup codes, session tokens or other credentials in the URL.
- [ ] From the live Pages origin, test the public leaderboard POST and confirm CORS/redirect behavior.
- [ ] On a fresh browser, confirm the Who are you? screen shows both the New user and Returning user paths, create a test account from only a character name, and confirm the backup code is displayed once with “Please save this somewhere”.
- [ ] Refresh and confirm the remembered-device cookie restores the account without any prompt; confirm the cookie contains only the opaque token.
- [ ] Clear the cookie (or sign out) and restore with character name + backup code; confirm the same member ID and progression return and that a wrong code returns only the generic failure.
- [ ] Test SV update, Master update, Master Seal six-dungeon update, identical updates and member sign-out.
- [ ] Test five-failure/15-minute restore throttling and session expiry/revocation behavior.
- [ ] On a browser still holding a valid legacy PIN-era session, confirm it migrates automatically to the cookie, shows the backup code once, and removes the old local storage; confirm no PIN is requested anywhere.
- [ ] Confirm browser-supplied totals are ignored and server-calculated totals are returned.
- [ ] Confirm malformed, oversized and unknown requests return safe JSON errors with no stack trace.

## Member-based administrator verification

- [ ] Restore as Dax and confirm the Administrator badge and protected view appear from the live role on the member session.
- [ ] Confirm an ordinary member cannot call any administrator action (including backup-code reveal/regenerate/revoke), even if browser controls are manually exposed.
- [ ] Promote a registered test member and confirm the audit entry identifies the acting member ID.
- [ ] Refresh the page repeatedly and confirm sessions are restored without adding rows to `Sessions`.
- [ ] With at least two active administrators, demote the test administrator and confirm their session stops authorizing admin actions immediately while member access remains valid.
- [ ] Confirm self-demotion requires the stronger warning and explicit confirmation.
- [ ] Confirm the final active administrator cannot be demoted, disabled or removed/merged away.
- [ ] Disable a test member and confirm all of that member’s sessions are revoked; re-enable only after verifying intent.
- [ ] Confirm sign-out revokes only the submitted token; confirm Revoke all devices ends every remembered session for that member only.
- [ ] Reveal a member’s backup code, copy it, regenerate it, confirm the old code fails immediately and the new one restores, and confirm the audit log records the actions without the codes.
- [ ] Exercise member edit/rename, duplicate keep/remove merge (including Master Seal reassignment), achievement correction, manual reset and audit-log viewing.
- [ ] Confirm every administrative mutation appears in `AuditLog` with the authenticated actor’s stable ID.
- [ ] If configured, test emergency recovery separately and confirm failed attempts are throttled. Do not use it for routine sign-in.

## Master Seal verification

- [ ] Confirm the Master Seal board lists every active member with all six dungeon values visible per row and a working detail panel.
- [ ] Confirm search, sorting, filters and keyboard row selection work and the reward track shows earned/next/locked states with Mount: Neon Sonic at 3,650.
- [ ] Update the signed-in member’s six dungeons, confirm totals/remaining/cleared/mount update, refresh and confirm persistence.
- [ ] Confirm a member cannot edit another member’s seal and that admin corrections are audited.

## One frontend API configuration

- [ ] Confirm the `configuredApiUrl` constant in `config.js` equals the current production `/exec` URL; after an Apps Script redeployment under a new URL, update only that constant. `?api=...` remains available for one-browser overrides or fresh forks still carrying the placeholder.
- [ ] Confirm `Leaderboard.html` and `AppFrontend.js` both use `window.BPSR_CONFIG`; no legacy `APP_CONFIG`, direct totals submission or second URL store remains.
- [ ] If a stale deployment was previously supplied, clear the site’s `bpsrApiUrl` local-storage value/site data.
- [ ] With no URL, confirm **Not configured** and the preview notice; member/admin writes must explain that saving is unavailable.
- [ ] With the real URL, confirm **Connecting**, then **Connected**, and confirm the preview notice stays hidden.
- [ ] Simulate a bad/network-failing deployment and confirm **API error** plus readable member/admin scoped errors.

## GitHub Pages and visual checks

- [ ] Open the tracker at `https://daa13x.github.io/BPSR-Guild-Tracker/`; use Apps Script `/exec` only as the backend endpoint and direct GET diagnostic.
- [ ] Confirm repository **Settings → Pages → Source** is **GitHub Actions**.
- [ ] Confirm `.github/workflows/pages.yml` publishes the repository root and the latest run succeeds.
- [ ] Open `https://daa13x.github.io/BPSR-Guild-Tracker/` and confirm `index.html` opens `Leaderboard.html` while retaining query/hash values.
- [ ] Confirm `config.js`, `styles.css`, `AppFrontend.js`, favicon and `assets/guild-logo.png` load beneath `/BPSR-Guild-Tracker/`; no asset assumes `/` hosting.
- [ ] Confirm the release bumps the shared `?v=` cache token in `Leaderboard.html` whenever `config.js`, `styles.css` or `AppFrontend.js` changed, so ten-minute Pages caching cannot serve stale assets with fresh HTML.
- [ ] Confirm the supplied transparent OnlyPaws logo is not stretched and its text fallback appears if the image request is blocked.
- [ ] Test desktop sidebar and narrow/mobile top navigation, including horizontal navigation scrolling.
- [ ] Test keyboard focus, leaderboard arrow-key tabs, form labels, status announcements and reduced-motion behavior.
- [ ] Test public empty, loading, search/filter, network-error and API-error states.
- [ ] Test registration, progression, role and destructive confirmations from the deployed origin.
- [ ] Confirm hostile-looking character names render as text rather than HTML.

## Security and release record

- [ ] Run `npm test`, `npm run check`, and `git diff --check` against the release commit.
- [ ] Search current files and Git history for secrets before publication. The only deployment URL permitted in Git is the sanctioned `configuredApiUrl` constant in `config.js`; `npm run check` rejects deployment URLs in any other file.
- [ ] Inspect public leaderboard and authenticated profile payloads for private fields.
- [ ] Confirm PINs and session tokens are never logged, placed in URLs or rendered into the DOM.
- [ ] Record the Git commit SHA, Apps Script deployment version, workflow run, spreadsheet owner, backup location, live-test results and date privately.
- [ ] Keep rollback instructions: redeploy the prior Apps Script version, revert Pages to a verified commit and restore a verified Sheet backup if data repair is required.
