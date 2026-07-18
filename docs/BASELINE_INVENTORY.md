# Claude baseline inventory

The imported `Code.gs` is retained as the domain foundation. It creates Config, Players, MasterActivities, MasterProgress, AchievementHistory, ProgressEvents, ResetPeriods and AuditLog; uses UUID-backed records; and exposes `setupSpreadsheet`, `doGet`, `submitProgress`, `startNewPeriod`, `correctAchievement` and `getLeaderboardBundle`.

Its preserved behaviours are batched leaderboard construction and cache invalidation, server-side progression diffing, SV/Master/mount rankings, immutable mount and first-to-achieve history, activity feed, reset-period calculations, script-lock first-updater award and audit logging. The baseline `Leaderboard.html` preserves tabs, podium, search/filters, hall of fame, first-updater/history, achievement cards, feed, responsive table/cards and escaped names.

Material migration: Google-account email identity and `google.script.run` are legacy baseline assumptions. `AuthApi.gs` introduces private character/PIN member, session and throttle tables plus JSON register/login/logout/leaderboard routes, member-based administrator roles, and optional emergency recovery. The supplied transparent OnlyPaws logo is preserved at `assets/guild-logo.png`.
