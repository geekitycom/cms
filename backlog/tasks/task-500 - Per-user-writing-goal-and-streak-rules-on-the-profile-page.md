---
id: TASK-500
title: 'Writing goals page: a "Track writing goals" switch, the goal and streak rules'
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 14:25'
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
- [ ] #1 The streak words field defaults to the goal for a daily goal and to the daily pace rounded up otherwise (100,000 a month gives 3,334), and can be changed
- [ ] #2 Invalid input (zero or negative words, unknown period, misses outside 0–7) is refused with a message next to the field
- [ ] #3 Progress sums the ledger over the current day, Monday-start week, month or year in the site timezone, and reports pace as ahead or behind the even share of the goal up to today
- [ ] #4 With missesAllowed 1, one missed day keeps the streak and two missed days in a row end it; missed days do not add to the count
- [ ] #5 Today not yet meeting the rule does not break the current streak; yesterday missing (beyond the allowance) does
- [ ] #6 Best streak is the longest run in the ledger under the current rules
- [ ] #7 Unit tests cover period boundaries (month ends, leap years, week starts, DST changes) and the streak rules
- [ ] #8 The page starts with a "Track writing goals" checkbox, off for every user until they check it; the goal and streak fields show only while it is checked, and work without JavaScript (fields are revealed after saving)
- [ ] #9 Unchecking turns tracking off but keeps the saved goal and rules, so checking again restores them
- [ ] #10 Checking the box requires a goal; saving with tracking on and no goal is refused with a message
<!-- AC:END -->
