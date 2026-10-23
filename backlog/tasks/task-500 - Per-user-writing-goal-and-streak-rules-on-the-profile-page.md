---
id: TASK-500
title: Per-user writing goal and streak rules on the profile page
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
labels:
  - writing-goals
milestone: m-48
dependencies: []
ordinal: 413800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each user sets an optional goal (`words` per `day`, `week`, `month` or `year`) and streak rules (`dailyWords`, `missesAllowed` 0–7) on their own profile page, stored on their record in `data/users.json` next to `dashboardLayout`. Pure functions turn a ledger plus rules into period progress, even pace for today, current streak and best streak. See decision-63, "Goals and streaks belong to the user".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A user can set, change and clear their goal; with no goal, streak fields are hidden and nothing else changes
- [ ] #2 The streak words field defaults to the goal for a daily goal and to the daily pace rounded up otherwise (100,000 a month gives 3,334), and can be changed
- [ ] #3 Invalid input (zero or negative words, unknown period, misses outside 0–7) is refused with a message next to the field
- [ ] #4 Progress sums the ledger over the current day, Monday-start week, month or year in the site timezone, and reports pace as ahead or behind the even share of the goal up to today
- [ ] #5 With missesAllowed 1, one missed day keeps the streak and two missed days in a row end it; missed days do not add to the count
- [ ] #6 Today not yet meeting the rule does not break the current streak; yesterday missing (beyond the allowance) does
- [ ] #7 Best streak is the longest run in the ledger under the current rules
- [ ] #8 Unit tests cover period boundaries (month ends, leap years, week starts, DST changes) and the streak rules
<!-- AC:END -->
