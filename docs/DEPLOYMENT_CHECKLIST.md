# Deployment checklist

## Google Sheet

- [ ] Create or select the production spreadsheet.
- [ ] Back up any existing production data.
- [ ] Open Extensions → Apps Script.
- [ ] Add the final Apps Script and HTML files.
- [ ] Run the idempotent setup/migration function.
- [ ] Confirm required sheets and headers.
- [ ] Confirm no demo members were inserted.
- [ ] Configure real Master activities and rank limits.
- [ ] Protect event, achievement, reset, audit, session, and throttle sheets where appropriate.

## Script Properties

- [ ] Set the initial admin secret or hash property required by the final implementation.
- [ ] Set any spreadsheet/configuration identifiers required by standalone deployment.
- [ ] Confirm no secret is stored in Git or a public sheet cell.
- [ ] Record a secure recovery and rotation procedure.

## Apps Script web app

- [ ] Deploy as a new web app or update the existing deployment.
- [ ] Use the execute-as option required by the final code and document why.
- [ ] Set access so intended guild members can reach the API.
- [ ] Copy the final `/exec` URL.
- [ ] Test public leaderboard access.
- [ ] Test registration, login, update, logout, and expired session.
- [ ] Test admin login and one non-destructive admin action.
- [ ] Confirm error payloads reveal no internals.

## GitHub Pages frontend

- [ ] Publish only static, non-secret files.
- [ ] Add the real logo under the documented path.
- [ ] Configure the Apps Script `/exec` URL in the single documented location.
- [ ] Confirm no private IDs or credentials are embedded.
- [ ] Enable Pages for the correct branch/folder or use a separate Pages repository.
- [ ] Test cross-origin API communication from the actual Pages origin.
- [ ] Test desktop and narrow mobile widths.
- [ ] Test loading, empty, network, and API error states.

## Security and privacy

- [ ] Search repository history and current files for secrets.
- [ ] Inspect public API payloads for private fields.
- [ ] Confirm PINs are never logged.
- [ ] Confirm logout and identity changes revoke sessions.
- [ ] Confirm all admin actions are authorised server-side and audited.
- [ ] Confirm user-controlled names cannot inject formulas or HTML.

## Release record

- [ ] Record the commit SHA and Apps Script deployment version.
- [ ] Record the production spreadsheet owner and backup location privately.
- [ ] Record manual test results and date.
- [ ] Keep rollback instructions.
