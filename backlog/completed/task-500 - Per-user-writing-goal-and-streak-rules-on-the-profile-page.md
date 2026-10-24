---
id: TASK-500
title: 'Writing goals page: a "Track writing goals" switch, the goal and streak rules'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 15:12'
labels:
  - writing-goals
milestone: m-48
dependencies: []
ordinal: 413800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each user has a Writing goals page for their own account. It starts with a "Track writing goals" checkbox, off by default. Only when it is checked does the page show the goal (`words` per `day`, `week`, `month` or `year`) and streak rules (`dailyWords`, `missesAllowed` 0–7). The settings are stored on the user's record in `data/users.json` next to `dashboardLayout`; unchecking keeps the saved goal so checking again restores it. Pure functions turn a ledger plus rules into period progress, even pace for today, current streak and best streak. See decision-63, "Goals and streaks belong to the user".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The streak words field defaults to the goal for a daily goal and to the daily pace rounded up otherwise (100,000 a month gives 3,334), and can be changed
- [x] #2 Invalid input (zero or negative words, unknown period, misses outside 0–7) is refused with a message next to the field
- [x] #3 Progress sums the ledger over the current day, Monday-start week, month or year in the site timezone, and reports pace as ahead or behind the even share of the goal up to today
- [x] #4 With missesAllowed 1, one missed day keeps the streak and two missed days in a row end it; missed days do not add to the count
- [x] #5 Today not yet meeting the rule does not break the current streak; yesterday missing (beyond the allowance) does
- [x] #6 Best streak is the longest run in the ledger under the current rules
- [x] #7 Unit tests cover period boundaries (month ends, leap years, week starts, DST changes) and the streak rules
- [x] #8 The page starts with a "Track writing goals" checkbox, off for every user until they check it; the goal and streak fields show only while it is checked, and work without JavaScript (fields are revealed after saving)
- [x] #9 Unchecking turns tracking off but keeps the saved goal and rules, so checking again restores them
- [x] #10 Checking the box requires a goal; saving with tracking on and no goal is refused with a message
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. site/writing-goals.ts (site layer, beside dashboard-layout.ts, since site/users.ts may not import services): WritingGoals { tracking, words, period, streak: { dailyWords, missesAllowed } } stored as user.writingGoals; a reader that drops an invalid value; defaultDailyWords (day = goal, week /7, month /30, year /365, rounded up); trackedWritingGoals(user) answers the goals only while tracking is on.
2. site/users.ts: parse, copy and save writingGoals (setUserWritingGoals).
3. writing/progress.ts (pure, beside the ledger): writingProgress(ledger, goals, now, timezone) -> today, wordsToday, period {start, end, words, goal, expected, pace}, streak {current, best, todayMet, todayNeeds}; meetsStreak(words, rule) for the calendar. Today comes from the ledger's own day function (exported as writingDay). Monday-start weeks via Temporal.PlainDate. One forward pass over days gives current and best; today unmet is not a miss.
4. admin/writing-goals.ts: GET/POST /admin/users/writing-goals for the signed-in user, Users menu child 'Writing goals'. Pure form parser: unchecked keeps the stored goal and turns tracking off; checked validates words, period, dailyWords (empty = default), missesAllowed 0-7; a field absent from the post (hidden because tracking was off) falls back to the stored value; no goal at all is refused. Fields render only while tracking is on (saved or in the refused post), so it works without JavaScript.
5. Template pages/users/writing-goals.njk with DaisyUI field macros, error summary, messages next to fields.
6. Tests first for each AC: progress/streak unit tests (month ends, leap years, week starts, DST), form parser tests, screen tests through the harness.
7. docs/admin.md: a Writing goals section. Run the full check suite and curl the page on a demo server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Storage: user.writingGoals = { tracking, words, period, streak: { dailyWords, missesAllowed } } in data/users.json. The streak rule is nested inside writingGoals rather than a second top-level field, so one field holds the feature and an unusable value drops as a whole. The reader (site/writing-goals.ts) lives in the site layer beside dashboard-layout.ts because site/users.ts may not import services.
Default streak words use fixed period lengths (week 7, month 30, year 365) so 100,000 a month gives 3,334 as the AC says. They are filled in at save time when the field is empty. Default missed days allowed on a fresh form is 1, the decision's example rule.
Form: a field missing from the post (not drawn because tracking was off) keeps its saved value. This is how re-ticking restores the goal without JavaScript. Unticking ignores the posted fields and only sets tracking false. The goal fields are drawn while tracking is on or the form was refused (hasProblems, the shared refused-form contract in form-errors.test.ts). Numbers accept thousands separators.
Progress: writing/progress.ts writingProgress(ledger, goals, now, timezone) -> { today, wordsToday, period { start, end, words, goal, expected, pace }, streak { current, best, todayMet, todayNeeds } }, plus meetsStreak(words, rule) for a calendar. Today comes from writingDay(), now exported from writing/ledger.ts (was the private dayOf), so progress and credits bucket days identically. Expected pace is the even share up to and including today, rounded up; pace = words - expected. One forward pass from the first met day gives current and best; today unmet is not a miss.
For TASK-501/502: trackedWritingGoals(user) in site/writing-goals.ts answers the goals only while tracking is on, so it is the 'is this user tracking' check.
Validation: pnpm build && pnpm test (7331 pass) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Mutation check: dropping the today-is-not-a-miss guard or the Monday offset fails the streak and week tests. HTTP: demo server.ts on port 3517 over a scratch content/data copy; curl confirmed unchecked by default with no goal fields, tracking with no goal refused 400 with the message by the Words field, 100,000/month saved with dailyWords 3334, untick kept the goal with tracking false and hid the fields, re-tick with only the switch restored it, misses 9 refused 400 by its field. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the Users > Writing goals page (/admin/users/writing-goals) for the signed-in user: a Track writing goals checkbox, off by default; goal words per day, week, month or year; streak words (defaulting to the goal or its daily pace rounded up); and missed days allowed (0-7). The settings are stored as writingGoals on the user record. Unticking keeps the goal and re-ticking restores it, and the page works without JavaScript. Added the pure writingProgress/meetsStreak functions in writing/progress.ts (period progress over Monday-start weeks, months and years in the site timezone, pace, and current and best streak) and trackedWritingGoals for TASK-501/502. Documented the page in docs/admin.md. Verified with unit and screen tests covering every criterion, the full build/test/lint/format suite, and curl against a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
