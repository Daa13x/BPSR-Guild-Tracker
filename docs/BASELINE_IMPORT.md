# Importing the Claude baseline

The user-supplied `files.zip` contains:

- `Code.gs`
- `Leaderboard.html`
- `README.md`

## Required import procedure

1. Extract the ZIP outside the repository.
2. Inspect all three files before copying.
3. Copy `Code.gs` and `Leaderboard.html` to the repository root.
4. Keep the existing README temporarily as `docs/CLAUDE_BASELINE_README.md` if useful for comparison.
5. Replace the root README only after the final implementation and deployment instructions agree with the code.
6. Record an inventory of existing functions and UI features before editing.

## Known baseline state

The baseline is an Apps Script-hosted implementation using `google.script.run` and Google-account email identity. It contains substantial leaderboard, achievement, event, reset, cache, and audit logic.

The intended migration changes identity to character name plus PIN, adds opaque sessions and admin Script Properties, exposes a safe JSON API, and converts the static deployment transport to `fetch()`.

## Preservation rule

Preserve working domain logic unless a test or security requirement demonstrates that it must change. Do not replace the project with React, Next.js, Firebase, Supabase, or another stack.

## Expected inventory

Before editing, identify:

- all sheet schemas
- setup/migration functions
- all public entry points
- player/member write paths
- leaderboard bundle construction
- event creation
- achievement creation/correction
- reset-period handling
- caching
- admin checks
- frontend render functions
- all `google.script.run` calls
- sample/demo data paths
- assumptions tied to Google email identity

Document any baseline feature intentionally removed or materially changed.
