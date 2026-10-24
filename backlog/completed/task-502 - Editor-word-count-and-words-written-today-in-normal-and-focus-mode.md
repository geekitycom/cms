---
id: TASK-502
title: 'Editor word count and words written today, in normal and focus mode'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 15:43'
labels:
  - writing-goals
milestone: m-48
dependencies:
  - TASK-498
  - TASK-499
ordinal: 415800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The post and page editor always shows the body's current word count and the words the user wrote today, in the normal view and in the focus mode bar ("1,240 words · 312 today"). The page carries today's total, each autosave response updates it, and the bundle adds the words typed since the last autosave using the shared module. See decision-63, "The editor".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The normal editor shows the current word count of the body, updating as the writer types
- [x] #2 Focus mode shows the same count and today's words in its bar
- [x] #3 Words written today rise as the writer types and match the ledger after the next autosave
- [x] #4 Deleting text lowers the word count but never lowers words written today
- [x] #5 Without JavaScript the editor shows the counts as of page load
- [x] #6 The counter is announced politely to screen readers at most when typing pauses, not on every keystroke
- [x] #7 Words written today show only for a user tracking writing goals; the current word count shows for everyone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure module src/admin/editor-words.ts: wordsLabel(count, today?) gives '1,240 words · 312 today' (moved from focus-mode.ts, callers migrated) and wordsTodayAt(baseline, body) = baseline.today + addedWords(baseline.body, body). Unit tests first.
2. Server: renderEditor computes the body's word count and, for a user whose writing goals are tracked, today's total from the ledger (corrupt ledger reads as 0 with a warning). editor.njk renders <p id="editor-words" data-words-today> under the body, so the count shows without JavaScript. App tests first (count for everyone, today only when tracking).
3. Bundle: editor/words.ts updates the counter on every doc change from the page's baseline, takes each autosave's wordsToday and the body it sent as the new baseline, and announces the label in a polite sr-only status region only after typing pauses.
4. Focus mode carries the #editor-words element into its bar (as it carries the autosave status line) instead of keeping its own count span.
5. Docs: docs/admin.md focus mode/editor section and docs/writing-goals.md mention the counter.
6. Verify: build, tests, typecheck, lint, format; Playwright against the demo on a spare port to watch the counter, focus bar, autosave reconcile and the live region.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- src/admin/editor-words.ts (pure, shared by server and bundle): wordsLabel(count, today?) moved here from focus-mode.ts and now renders '1,240 words · 312 today'; wordsTodayAt(baseline, body) = baseline.today + addedWords(baseline.body, body).
- src/admin/editor-word-counter.ts: renderEditor's counter as of page load. Today's figure only when trackedWritingGoals(user) is set; a ledger that cannot be read warns and shows 0 so the editor still opens.
- editor.njk renders <p id="editor-words" data-words-today> right under the body field.
- editor/words.ts: updates the counter on every doc change; the autosave send hook (editor/autosave.ts) hands back each saved body with the response's wordsToday, which becomes the new baseline. The visible text is aria-hidden; a sr-only role=status span gets the label 1.5 s after typing stops.
- Focus mode carries #editor-words into its bar with the autosave status line, before hiding everything else (its own count span and the changed() hook are gone).
- Docs: docs/admin.md 'The word counter' section, focus mode paragraph and enhancement list; docs/writing-goals.md links to it.

Decision on AC4: today's figure is the server's last total plus the words added since that autosave's body. Deleting text the server already has never lowers it. Deleting words typed since the last autosave takes them back off, because the ledger never credits them (decision-63 counts additions between the texts the server receives), and a monotonic display would drop at the next autosave instead, breaking AC3.

Verification:
- Unit: src/admin/editor-words.test.ts. App: 'the editor's word counter' in src/admin/writing-ledger.test.ts (count without tracking and no today; count plus today when tracking; corrupt ledger gives 0 today and a 200).
- Browser (Chromium via playwright-core against apps/demo server.ts on port 3517 with scratch content and data dirs, stopped by PID afterwards): new page, typed 5 words -> '5 words · 5 today' at once with the live region still empty, live region filled after the pause; after autosave the ledger file said 5 and the counter matched; deleting 2 words -> '3 words · 5 today', ledger still 5 after autosave; typing ' six' -> 6 today and ledger 6; focus mode shows the counter in the bar, visible, updating as typed (6 words · 8 today) and back under the body after Exit focus; JavaScript disabled shows '98 words · N today' on about.md (98 = wordCount of its body) with data-words-today from the ledger; tracking off shows '0 words' then '3 words', never 'today', before and after autosave.
- pnpm build, pnpm test (cms 7360 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The post and page editor shows the body's word count under the body and in the focus mode bar, with the words written today beside it for a user who tracks writing goals. The server renders both as of page load; the bundle updates them as the writer types from the page's (or last autosave's) total plus added words, and announces the label politely after typing pauses. Verified with unit and app tests, the full build/test/typecheck/lint/format suite, and a Chromium run that compared the counter with the ledger file across typing, deleting, autosaves, focus mode, no-JS and an untracked user.
<!-- SECTION:FINAL_SUMMARY:END -->
