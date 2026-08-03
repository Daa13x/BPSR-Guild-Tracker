# Public static-data migration

## Scope and source of truth

`data/*.json` is the authoritative, version-controlled source for shared BPSR
class and Master Seal definitions. GitHub Pages serves these files from the
same origin as the application. Google Sheets remains authoritative for every
member, security, administrative, recovery, progress, score, and event record.

The server retains equivalent generated-in-practice constants only to validate
browser-submitted stable IDs without making Apps Script fetch GitHub. Run
`npm run check:static-data` before a release; it fails if either server
validation catalogue differs from the canonical JSON.

## Inventory and classification

| Data item | Current source | Personal / non-personal | Public / private | Read frequency | Write frequency | New source | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Class IDs, labels, roles, colours, build IDs, icon mapping | `classes.js` / `Classes.gs` constants | Non-personal | Public | Every class display | Rare release edit | `data/classes.json` | Shared stable lookup; IDs remain authoritative. |
| Master Seal season, dungeon IDs/order/labels, rewards, limits | `MasterSeal.gs` constant | Non-personal | Public | Master Seal view | Rare season edit | `data/master-seal.json` | Shared stable lookup and scoring envelope. |
| Static-data version/file map | None | Non-personal | Public | Once per page session | Release only | `data/manifest.json` | Explicit compatibility contract. |
| `Config` operational settings and reset anchors | Sheets `Config` | Non-personal but operational | Private/admin-controlled | Server requests | Admin edit | Sheets / Apps Script | Mutable operational authority; not a public configuration API. |
| Master activities / active rank limits | Sheets `MasterActivities` | Guild-wide but operational | Admin-controlled | Leaderboard requests | Admin edit | Sheets / Apps Script | Changes live and controls scoring behaviour. |
| Players, character names, avatars, roles, visibility, difficulty flags | Sheets `Players` | Personal/member-specific | Private plus limited public projections | Most views | Member/admin updates | Sheets / Apps Script | Personal and authoritative. |
| Classes, ClassSlots, ClassSelections | Sheets | Personal/member-specific | Private | Signed-in class editor | Member updates | Sheets / Apps Script | Primary/secondary selections and builds are member data. |
| MasterSeal, MasterProgress, achievements, events, reset periods | Sheets | Personal/member-specific | Private with public projections | Board/progress requests | Game/admin updates | Sheets / Apps Script | Authoritative progression, history and leaderboards. |
| Members, sessions, links, login attempts, backup codes | Sheets | Personal/security-sensitive | Private | Authentication/recovery | Authentication/admin | Sheets / Apps Script | Accounts, recovery, linked alts and sessions must never be static. |
| AuditLog, admin notes, moderation state | Sheets | Personal/admin-sensitive | Private | Admin only | Admin actions | Sheets / Apps Script | Administrative authority and audit history. |

## Static schemas

- `data/manifest.json`: `{ schemaVersion: 1, dataVersion, updatedAt, files }`.
- `data/classes.json`: `{ schemaVersion: 1, colours, iconSource, classes[] }`.
  Class and build `id` values are stable keys; display labels must never be used
  as write keys. Icon paths are resolved by class ID.
- `data/master-seal.json`: `{ schemaVersion: 1, id, maxScore,
  maxMasterLevel, dungeons[], rewards[] }`.

`StaticData.js` fetches the manifest and two definitions once per page session,
shares concurrent requests, deep-freezes valid results, retries only on an
explicit `retry()`, and discards failed promises. Unsupported versions,
malformed JSON, and invalid IDs fail with bounded `STATIC_*` errors instead of
silently accepting mixed data.

## Editing, preview, deployment, and rollback

1. Edit only the JSON file for the public category. Keep IDs stable; append or
   reorder display lists only when that is the intended UI change.
2. Update the matching Apps Script constant in `Classes.gs` or `MasterSeal.gs`
   in the same change. `npm run check:static-data` is the deterministic drift
   check and privacy guard.
3. Run `npm test`, `npm run check`, and `npm run dev` for a local preview.
4. Commit and push `main`; the existing GitHub Pages workflow deploys the root.
5. To roll back, revert the Git commit. The legacy Sheets tabs are intentionally
   untouched, so there is no destructive spreadsheet migration in this release.

The repository scanner rejects sensitive field names in static JSON, including
member names, account IDs, recovery/authentication material, tokens, avatar
URLs, progress records, scores, and completion ownership. `maxScore` and the
reward-threshold `score` are the only reviewed semantic exceptions because they
are public season rules, not individual member scores.
