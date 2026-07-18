# OnlyPaws BPSR Guild Tracker

A build-free guild progression tracker backed by Google Sheets and Google Apps Script, with a static GitHub Pages interface at `https://daa13x.github.io/BPSR-Guild-Tracker/`. The imported leaderboard, ranking, achievement, event, reset-period, cache and audit logic remains the domain foundation.

## Architecture

- `Code.gs` owns the Sheets schema, server-calculated totals, rankings, progression events, achievements, reset periods, caching, audit utilities and the safe `GET /exec` health response.
- `AuthApi.gs` exposes the JSON `POST /exec` API, character-name/PIN authentication, opaque sessions and protected member/administrator actions.
- `Leaderboard.html`, `styles.css`, `config.js` and `AppFrontend.js` are the static HTML/CSS/vanilla-JavaScript application. No React, bundler or production Node server is used.
- `index.html` opens `Leaderboard.html` with repository-relative paths suitable for the GitHub Pages project path.

```text
Code.gs                         Sheets/domain implementation
AuthApi.gs                      JSON API, PIN, session and role enforcement
index.html                      GitHub Pages entry point
Leaderboard.html               Dashboard and public leaderboard
styles.css                      OnlyPaws application-shell design
config.js                       One authoritative Apps Script URL
AppFrontend.js                  Member and administrator controller
assets/guild-logo.png           Supplied transparent OnlyPaws logo
.github/workflows/pages.yml     Root-folder Pages deployment
tests/                          Apps Script runtime and DOM-controller tests
```

## Authentication and administration

Members register and sign in with a unique character name and PIN. The API stores a unique salt and derived PIN hash, never the plaintext PIN. Public responses never contain PIN material, token hashes, salts, session tokens, spreadsheet IDs or raw rows. Sessions expire after 12 hours; five failed attempts create a 15-minute failed-login window.

`Players.IsAdmin` is the authoritative role flag. `Members.MemberId` and `Players.UserId` must be the same stable identifier and each member must map to exactly one player row. An administrator signs in through the normal member form. A fresh sign-in returns one separate member-bound administrator session after rechecking `IsAdmin`; member refresh returns the current profile and role without minting or replacing an administrator session. The browser restores a stored administrator token separately through the protected administrator refresh path, and every protected route rechecks the live member state and role.

If an administrator closes the administrator session while keeping the member session open, ordinary page restoration does not silently reopen it. Sign out of the member account and sign in again to obtain a new administrator session. Emergency recovery remains a separate last-resort path, not the normal solution.

The prepared spreadsheet’s initial administrator is Dax because Dax’s `Players.IsAdmin` value is `TRUE`. Confirm Dax’s `Members.MemberId` exactly matches Dax’s `Players.UserId`. Dax uses the existing normal PIN flow—there is no default or repository-stored PIN.

Administrators can promote and demote registered members in the protected interface. Role changes are audited and clear caches; demotion revokes that member’s administrator sessions. Disabling a member revokes all of that member’s sessions. The last active administrator cannot be demoted, disabled or removed. Member and administrator logout each revoke only the submitted token, leaving unrelated sessions intact.

`BPSR_ADMIN_SECRET` is optional emergency recovery only. If retained, store a long random value in Apps Script Script Properties. It is throttled and must not be used as the normal administrator login or committed to Git.

Character-name/PIN authentication is suitable for a small trusted guild, not high-security identity verification. Keep private sheets protected, restrict Apps Script access appropriately and maintain spreadsheet backups.

## Backend setup and redeployment

1. Back up the production spreadsheet and open **Extensions → Apps Script**.
2. Copy the final `Code.gs` and `AuthApi.gs` into the bound Apps Script project. `Leaderboard.html` is not required or served there: GitHub Pages hosts the interface, while Apps Script `/exec` hosts only the JSON API.
3. Run `setupSpreadsheet()` once. It is idempotent and does not seed demo members.
4. Verify every `Members.MemberId` has exactly one matching `Players.UserId`. In particular, verify Dax’s matching player row has `IsAdmin=TRUE` before relying on normal administrator login.
5. Review `Config`, configure `MasterActivities`, and protect `Members`, `Sessions`, `LoginAttempts`, events, achievements, resets and audit sheets.
6. Optionally set Script Property `BPSR_ADMIN_SECRET` for emergency recovery. Do not set any PIN, hash, salt or token in repository files.
7. Choose **Deploy → Manage deployments**, edit the web-app deployment, select **New version**, and deploy with the access policy intended for the guild.
8. Copy the resulting HTTPS URL ending in `/exec`. A source edit is not live until a new Apps Script deployment version is created.

Opening `/exec` directly sends a `GET` request and returns this static JSON health response:

```json
{
  "ok": true,
  "service": "BPSR Guild Tracker API",
  "status": "ready",
  "message": "Use POST requests for API actions."
}
```

This confirms only that the deployed GET handler is reachable; it does not verify spreadsheet authorization, POST routing, authentication or Pages-origin behavior. The tracker interface remains `https://daa13x.github.io/BPSR-Guild-Tracker/`. Public and protected API actions use JSON `POST` requests, and credentials or session tokens must never be placed in the URL.

## Configure the one API URL

`config.js` is the only frontend API configuration source, and its `configuredApiUrl` constant is the single sanctioned location for the production `/exec` URL. The committed constant is the live production deployment URL; after redeploying the Apps Script web app under a new URL, update only that constant:

```js
var configuredApiUrl = 'https://script.google.com/macros/s/.../exec';
```

A fresh fork may instead carry the documented `PASTE_APPS_SCRIPT_EXEC_URL_HERE` placeholder until its own deployment exists; `npm run check` accepts exactly those two forms and still rejects deployment URLs anywhere else in the repository. Do not invent an URL and do not place credentials in it. `BPSR_CONFIG.apiUrl` sends JSON `POST` requests for public leaderboard, member and administrator actions; direct browser navigation to the same URL is only the GET health diagnostic.

For one-browser setup, `?api=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2F...%2Fexec` is also accepted. Only an explicitly supplied, valid HTTPS Apps Script `/exec` URL is stored under `bpsrApiUrl`; invalid or unrelated URLs fail closed. Clear the site’s local storage if an obsolete test deployment was saved. Editing the constant is the recommended shared Pages configuration.

The sidebar reports **Not configured**, **Connecting**, **Connected**, or **API error**. The preview notice appears only while no valid API URL is configured. The public leaderboard interface remains viewable, but registration and saving are unavailable until the backend is connected.

## GitHub Pages

1. Open repository **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Merge an approved change to `main` or run **Deploy GitHub Pages** with `workflow_dispatch`.
4. Confirm the workflow succeeds and open `https://daa13x.github.io/BPSR-Guild-Tracker/`.
5. Hard-refresh after changing `config.js`, then verify the connection state and a harmless leaderboard request.

The workflow uploads the repository root. `.nojekyll`, `index.html`, `Leaderboard.html`, `config.js`, `styles.css`, `AppFrontend.js` and `assets/guild-logo.png` therefore retain project-relative URLs under `/BPSR-Guild-Tracker/`. A 404 usually means Pages Source is not GitHub Actions or deployment has not completed; a missing logo/script/style usually means a file or case-sensitive relative path is wrong; a failed publication is diagnosed in the Actions run log. If `/exec` still returns HTML or a missing-`Leaderboard` error, deploy a new Apps Script version. If the health GET succeeds but Pages cannot connect, verify `config.js`, deployment access, POST redirect/response behavior and the Apps Script execution log.

To replace the logo, overwrite `assets/guild-logo.png` with the approved transparent image at the same path, retain its aspect ratio, then verify both desktop and mobile. The sidebar supplies an OnlyPaws text fallback if the image fails.

## Validation and remaining live checks

Run:

```text
npm test
npm run check
git diff --check
```

Automated tests execute the real Apps Script sources in a mocked Sheets/Apps Script runtime and execute the frontend’s actual DOM event handlers and state transitions. Local automation cannot prove Google authorization, the production spreadsheet’s contents and protections, the deployed `/exec` CORS behavior, or the final Pages workflow. Complete `docs/DEPLOYMENT_CHECKLIST.md`, record the Apps Script deployment version and Git commit, and test the live origin before release.
