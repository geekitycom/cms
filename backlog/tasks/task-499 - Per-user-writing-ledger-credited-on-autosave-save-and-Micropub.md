---
id: TASK-499
title: 'Per-user writing ledger credited on autosave, save and Micropub'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 14:11'
updated_date: '2026-10-23 15:00'
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
- [x] #1 An autosave credits the words added since the user's previous autosave copy of that document (or the saved file when there is no copy)
- [x] #2 A save, publish or update credits the words added since the autosave copy or the file on disk; saving twice with no changes credits nothing the second time
- [x] #3 Typing 100 words, autosaving, then saving credits 100 words in total, not 200
- [x] #4 A Micropub create credits the whole body to the token's user; a Micropub update credits only added words
- [x] #5 Imports, the CLI and MCP writes credit no one
- [x] #6 Days are bucketed in the site timezone; a credit at 23:59 and one at 00:01 land on different days
- [x] #7 Two users editing one post are credited separately from their own copies
- [x] #8 The ledger is written atomically, is declared as a kept, private data file under decision-55, and is deleted with its user
- [x] #9 The autosave response includes the user's total for today
- [x] #10 docs describe the ledger file and what counts as writing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add writing/ledger.ts (services layer): WRITING declaration 'writing/*.json' kept in files/data-files.ts; readWritingLedger(dataDir,userId) -> { days }; creditWriting(dataDir,{userId,before,after,at,timezone}) adds addedWords(before,after) to the site-timezone day via updateFileAtomically (mode 0600) and returns that day's total; discardWritingLedger on user delete.
2. Autosave route: before = user's previous copy body, else the file's body, else ''; credit and return wordsToday in the JSON answer.
3. Editor save (saveFromForm): read the user's copy before it is discarded; credit addedWords(copy body ?? document body ?? '', saved.body) only on a saved outcome.
4. Micropub create/update: credit bearer.user with addedWords('' or document.body, saved.body).
5. deleteUser removes the ledger. Add writing/ to the services layer in layer-boundary.test.ts.
6. Tests first for each AC (ledger unit tests, autosave/save/micropub route tests, import/CLI paths credit nothing).
7. Docs: content.md data table, personal-data.md, admin.md autosave answer, a 'what counts as writing' section.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New services unit packages/cms/src/writing/ledger.ts: readWritingLedger(dataDir, userId) -> { days }, creditWriting(dataDir, { userId, before, after, at, timezone }) -> that day's total, discardWritingLedger. Credits use addedWords from content/words.ts and calendarDayIn in the site timezone; the file is updated with updateFileAtomically at mode 0600, so concurrent credits are not lost (tested with 20 at once). A ledger that does not parse is refused, not overwritten, because it cannot be rebuilt.
Declared as WRITING_LEDGERS 'writing/*.json', kind kept, in files/data-files.ts; writing/ added to the services layer in layer-boundary.test.ts.
Callers: POST /admin/autosave (before = previous copy body, else the file body, else ''; answers wordsToday), editor saveFromForm (before = copy body, else document body, else ''; credited only on a saved outcome, before the copy is discarded), Micropub create ('' -> saved body) and update (document body -> saved body) for bearer.user. deleteUser removes the ledger. A test pins the credit callers to those three files, so imports, the CLI and any future writer credit no one unless the test is changed. There is no MCP surface in this repo.
Validation: pnpm build, typecheck, lint, format:check, test (cms 7293 pass) and test:11ty all pass. Live check: demo server on :3499 with scratch dirs; two curl autosaves answered wordsToday 5 then 7, publishing the note left the ledger at 7, data/writing/1.json mode 0600.

Orchestrator review: creditWriting now catches its own failures, warns and answers 0, because every caller has already saved the user's text; a corrupt ledger is still left untouched and readWritingLedger still throws on it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a per-user writing ledger at data/writing/<userId>.json (kept, mode 0600, atomic, deleted with its user). Autosave, editor save/publish/update and Micropub create/update credit the words added since the last text the server saw from that user (autosave copy, else file, else nothing), bucketed by day in the site timezone; imports and the CLI credit no one. The autosave answer now carries wordsToday. Docs: admin.md 'Words written', content.md and personal-data.md rows. Verified with writing/ledger.test.ts, admin/writing-ledger.test.ts, micropub/writing.test.ts, the full test/lint/typecheck/format chain, and a curl run against the demo server.
<!-- SECTION:FINAL_SUMMARY:END -->
