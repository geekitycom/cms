---
id: TASK-498
title: Shared word counting and added-word diff for Markdown bodies
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 14:42'
labels:
  - writing-goals
milestone: m-48
dependencies: []
ordinal: 411800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One pure module counts the words in a Markdown body and the words a later body adds to an earlier one. The server ledger, the dashboard and the editor bundle all use it, so their figures agree. It replaces `wordCount` in `admin/focus-mode.ts`. See decision-63, "One way to count words".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A word is a run containing a letter or digit; link and image targets, HTML tags and Markdown markers are not counted, so `[my post](https://example.com/a/b)` counts as two words
- [x] #2 Text inside inline code and code blocks still counts
- [x] #3 Added words: inserting text credits its words, deleting credits none, replacing one word with another credits one, and an unchanged body credits zero
- [x] #4 Adding one sentence to a 10,000-word body is computed in well under 50 ms (common prefix and suffix are trimmed before the diff)
- [x] #5 Focus mode uses the shared count, and the editor bundle imports the same module the server uses
- [x] #6 Unit tests cover counting and added words, including Unicode letters, numbers, emoji-only runs and empty bodies
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/content/words.ts, a pure module with no Node imports (content layer, so the future writing ledger, admin dashboard and editor bundle can all import it). Exports wordCount(markdown) and addedWords(before, after), both built on one tokenizer so wordCount(x) === addedWords('', x).
2. Tokenizer: fenced code lines keep their text, fence lines drop; outside code, link/image targets, reference definitions, HTML tags and comments, ordered-list numbers and task boxes are removed; inline code spans keep their text. A word is a whitespace run with a letter or digit, compared with its edge punctuation trimmed.
3. addedWords: trim common prefix and suffix, then Myers shortest edit distance on the middle; insertions = (D + m - n) / 2. Above an edit cap, fall back to the per-word multiset surplus so a full rewrite stays fast.
4. Tests first in src/content/words.test.ts for each criterion, including Unicode, numbers, emoji-only runs, empty bodies, and a 10,000-word timing check.
5. Move focus mode to the shared count: delete wordCount from admin/focus-mode.ts and its tests, import from content/words.ts in editor/focus.ts; confirm via esbuild metafile that the editor bundle includes src/content/words.ts.
6. Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Module: packages/cms/src/content/words.ts (content layer, pure, no Node imports). Exports wordCount(markdown) and addedWords(before, after); both share one tokenizer, so addedWords('', body) === wordCount(body).
Decisions: words compare case-insensitively with edge punctuation trimmed, so recasing, bolding, linking or punctuating a word credits nothing. Footnote labels, ordered-list numbers and task boxes are markers and do not count. Image alt text counts. Fenced code keeps its text; the fence lines (with their info string) do not count.
addedWords trims the common prefix and suffix, then runs Myers' edit distance on the middle (insertions = (D + m - n) / 2). Past 2,000 edits it falls back to the per-word surplus (a lower bound), so a full 5,000-word rewrite takes about 12 ms.
Timing: one sentence into a 10,010-word body measured 2-3 ms; the test asserts under 25 ms.
Focus mode: wordCount removed from admin/focus-mode.ts (and its tests, now covered in content/words.test.ts); editor/focus.ts imports src/content/words.ts. An esbuild metafile of editor/main.ts lists src/content/words.ts as an input, and the server build emits dist/content/words.js.
Validation: pnpm build, pnpm test (cms 7269 pass, 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added packages/cms/src/content/words.ts: wordCount and addedWords for Markdown bodies, shared by the server and the editor bundle. A word is a run with a letter or digit after link targets, HTML tags and comments, reference definitions and Markdown markers are removed; code text still counts. addedWords is a word-level Myers diff after trimming the common prefix and suffix, with a multiset fallback past 2,000 edits. Focus mode now uses it and its old wordCount is gone. Verified with src/content/words.test.ts (18 cases incl. Unicode, numbers, emoji-only runs, empty bodies, a 10,000-word timing check), an esbuild metafile check of the editor bundle, and the full build/test/test:11ty/typecheck/lint/format:check run.
<!-- SECTION:FINAL_SUMMARY:END -->
