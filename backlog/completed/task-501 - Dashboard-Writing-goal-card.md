---
id: TASK-501
title: Dashboard Writing goal card
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 15:26'
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
- [x] #1 The card shows period words / goal with a progress bar and percentage, and how far ahead of or behind even pace the user is
- [x] #2 The card shows words today, the current streak and the best streak, and says when today still needs words to keep the streak going
- [x] #3 A calendar of words per day marks the days that met the streak rule
- [x] #4 Two users signed in at once each see their own figures; a cached result is never shown to another user
- [x] #5 The card can be moved, collapsed and removed like the other dashboard cards
- [x] #6 docs/writing-goals.md explains goals, streak rules, what counts as a word and what counts as writing, in plain prose, linked from the docs index
- [x] #7 A user who has not checked "Track writing goals" sees no card and no option to add it; checking it makes the card appear, and unchecking removes it again
- [x] #8 With tracking on but no words yet, the card says so instead of showing an empty chart
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Widget board: a WidgetLoad may carry a viewer (user id); the board's cache key is owner, widget, period and viewer, so a per-user result is never served to another user. Unit test in widgets.test.ts first.
2. CoreWidget gains forUser(user): boolean. dashboardWidgets looks up the signed-in user once, leaves out a forUser widget the user does not pass (so it is neither drawn nor listed under Add back), sets viewer, and hands the user to load.
3. Blocks: a progress block { label, value, max } drawn as a DaisyUI progress bar with 'value of max' and a percentage; calendar days may carry marked: true with a calendar-level mark label, drawn as an outlined cell, named in the cell title, the description and the numbers table. Documented in docs/plugins.md.
4. widget-writing.ts: core 'writing-goal' card, half width, refreshSeconds 0, forUser = trackedWritingGoals. Blocks: progress (words this period / goal), pace paragraph (ahead/behind/on even pace), stats (words today, current and best streak), streak paragraph (words still needed today), calendar of 52 weeks of words per day marking days that meet the streak rule. Empty ledger: progress plus a 'no words yet' paragraph, no calendar. Unreadable ledger: a paragraph saying so, plus a console warning.
5. Integration tests (widget-writing.test.ts) for AC1-5, 7, 8 through the real /admin page with two users.
6. docs/writing-goals.md: move Words written and Writing goals out of docs/admin.md, add the dashboard card; link from docs/README.md and admin.md.
7. Gates: pnpm build, test, test:11ty, typecheck, lint, format:check; curl the demo dashboard.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- Widget board: WidgetLoad.viewer (user id) is part of the cache key (owner, widget, period, viewer), so a per-user result, fresh or stale, is never served to another user. CoreWidget.forUser(user) leaves the card out of dashboardWidgets for anyone it rejects, which removes it from the drawn cards and from Add back (both come from that list); load now receives the signed-in user.
- New public block 'progress' { label, value, max } (DaisyUI progress, 'value of max · pct%'), and calendar days may carry marked: true with a calendar 'mark' label (outlined cell, title, description, key and a Yes/No column). Documented in docs/plugins.md. Additive to PluginBlock.
- widget-writing.ts: core 'writing-goal' card, half width, refreshSeconds 0 (one small local file that changes on every autosave), placed second in CORE_WIDGETS. Empty ledger: bar plus 'No words written yet', no calendar. Unreadable ledger: a paragraph and a console warning.
- docs/writing-goals.md is new; the Words written and Writing goals sections moved there from docs/admin.md (admin.md keeps a pointer, the /admin row and the autosave link point at it); content.md data-file row relinked; docs index links it.
Validation: pnpm build, pnpm test (cms 7352 pass, 0 fail; all packages pass), pnpm test:11ty, pnpm typecheck, pnpm lint (doc links resolve in 49 files), pnpm format:check all pass. Demo server on port 3517 with a scratch data dir: no card before tracking; after ticking, '0 of 250 · 0%' and 'No words written yet'; after one autosave of 12 words, wordsToday 12, '12 of 250 · 4%', '238 words behind even pace', streak 0 and the calendar; after unticking, signed-in dashboard (200, 5 cards) has no Writing goal text. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the dashboard Writing goal card for users who track writing goals: progress bar and percentage for the goal period, pace against even pace, words today, current and best streak with what today still needs, and a 52-week calendar of words per day that outlines days meeting the streak rule. The widget board now keys results by user for per-user cards, and a core widget can be limited to users who pass forUser, so the card is neither drawn nor offered under Add back for other users. Added a public 'progress' block and calendar day marks. New docs/writing-goals.md (moved from docs/admin.md) linked from the docs index. Verified with widget-writing.test.ts (AC 1-5, 7, 8 through /admin with two users), widgets.test.ts (per-user cache key), blocks.test.ts, the full build/test/test:11ty/typecheck/lint/format gates, and curl against the demo server.
<!-- SECTION:FINAL_SUMMARY:END -->
