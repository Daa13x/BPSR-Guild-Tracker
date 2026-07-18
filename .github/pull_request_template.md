## Summary

Describe what changed and which existing Claude functionality was preserved.

## Architecture

- [ ] Static frontend remains build-free
- [ ] Google Apps Script owns validation and authorization
- [ ] Google Sheets setup/migration is idempotent
- [ ] No secrets are committed

## Testing

List exact commands and results.

- [ ] Backend tests
- [ ] Frontend/DOM tests
- [ ] Syntax/project checks
- [ ] Public payload privacy inspection
- [ ] Manual checks still required are disclosed

## Security

- [ ] PINs are salted/derived server-side and never logged
- [ ] Member and admin sessions expire and can be revoked
- [ ] Every protected action validates authorization server-side
- [ ] Client totals are ignored
- [ ] User-controlled text is safely rendered and sheet-safe
- [ ] Admin mutations are audited

## Deployment

- [ ] Apps Script instructions updated
- [ ] GitHub Pages instructions updated
- [ ] Required Script Properties documented
- [ ] No demo data is seeded into production

## Remaining limitations

List anything not run or verified, especially real Google deployment and browser-origin checks.
