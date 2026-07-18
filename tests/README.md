# Tests

Codex should create tests that execute the real `Code.gs` logic inside a mocked Google Apps Script runtime.

Suggested structure:

```text
tests/
  backend/
    auth.test.js
    progress.test.js
    leaderboard.test.js
    admin.test.js
    api.test.js
  frontend/
    ui.test.js
  helpers/
    apps-script-mock.js
    load-code-gs.js
```

The loader may use Node's `vm` module to evaluate `Code.gs` with mocked globals such as `SpreadsheetApp`, `Utilities`, `PropertiesService`, `LockService`, `CacheService`, `ContentService`, and `HtmlService`.

Tests must not silently replace production functions with simplified copies. Mock platform services, not business behaviour.
