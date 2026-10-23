---
id: TASK-501
title: Dashboard Writing goal card
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 14:25'
labels:
  - writing-goals
milestone: m-48
dependencies:
  - TASK-499
  - TASK-500
ordinal: 414800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A core dashboard card for the signed-in user shows words this period against their goal, pace for today, words today, current and best streak, and a calendar of words per day. The card exists only for a user who has checked "Track writing goals" (TASK-500); for everyone else it is not drawn and is not offered among the cards they can add back. The widget board caches by owner, widget and period, so this card's cache must also be keyed by user. See decision-63.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The card shows period words / goal with a progress bar and percentage, and how far ahead of or behind even pace the user is
- [ ] #2 The card shows words today, the current streak and the best streak, and says when today still needs words to keep the streak going
- [ ] #3 A calendar of words per day marks the days that met the streak rule
- [ ] #4 Two users signed in at once each see their own figures; a cached result is never shown to another user
- [ ] #5 The card can be moved, collapsed and removed like the other dashboard cards
- [ ] #6 docs/writing-goals.md explains goals, streak rules, what counts as a word and what counts as writing, in plain prose, linked from the docs index
- [ ] #7 A user who has not checked "Track writing goals" sees no card and no option to add it; checking it makes the card appear, and unchecking removes it again
- [ ] #8 With tracking on but no words yet, the card says so instead of showing an empty chart
<!-- AC:END -->
