---
id: TASK-499
title: 'Per-user writing ledger credited on autosave, save and Micropub'
status: To Do
assignee: []
created_date: '2026-10-23 14:11'
labels:
  - writing-goals
milestone: m-48
dependencies:
  - TASK-498
ordinal: 412800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Credit the words a user adds to a per-user daily ledger at `data/writing/<userId>.json`, keyed by day in the site timezone. Credits happen on autosave, on save/publish/update in the editor, and on Micropub create/update made with that user's token; imports, the CLI and MCP never credit. The earlier text is the user's autosave copy, else the file on disk, else nothing for a new document, so no extra baseline store is needed. See decision-63.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An autosave credits the words added since the user's previous autosave copy of that document (or the saved file when there is no copy)
- [ ] #2 A save, publish or update credits the words added since the autosave copy or the file on disk; saving twice with no changes credits nothing the second time
- [ ] #3 Typing 100 words, autosaving, then saving credits 100 words in total, not 200
- [ ] #4 A Micropub create credits the whole body to the token's user; a Micropub update credits only added words
- [ ] #5 Imports, the CLI and MCP writes credit no one
- [ ] #6 Days are bucketed in the site timezone; a credit at 23:59 and one at 00:01 land on different days
- [ ] #7 Two users editing one post are credited separately from their own copies
- [ ] #8 The ledger is written atomically, is declared as a kept, private data file under decision-55, and is deleted with its user
- [ ] #9 The autosave response includes the user's total for today
- [ ] #10 docs describe the ledger file and what counts as writing
<!-- AC:END -->
