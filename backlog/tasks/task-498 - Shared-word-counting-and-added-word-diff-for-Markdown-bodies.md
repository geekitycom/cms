---
id: TASK-498
title: Shared word counting and added-word diff for Markdown bodies
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
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
- [ ] #1 A word is a run containing a letter or digit; link and image targets, HTML tags and Markdown markers are not counted, so `[my post](https://example.com/a/b)` counts as two words
- [ ] #2 Text inside inline code and code blocks still counts
- [ ] #3 Added words: inserting text credits its words, deleting credits none, replacing one word with another credits one, and an unchanged body credits zero
- [ ] #4 Adding one sentence to a 10,000-word body is computed in well under 50 ms (common prefix and suffix are trimmed before the diff)
- [ ] #5 Focus mode uses the shared count, and the editor bundle imports the same module the server uses
- [ ] #6 Unit tests cover counting and added words, including Unicode letters, numbers, emoji-only runs and empty bodies
<!-- AC:END -->
