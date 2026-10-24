---
id: TASK-513
title: Map store rows through one typed helper
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 13:12'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 424800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/store/ casts with as Record<string, unknown> 42 times, and almost every method repeats (stmt.all(x) as Record<string, unknown>[]).map(toX).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Store modules read rows through a shared helper that takes a statement and a mapper
- [x] #2 as Record<string, unknown> row casts in store/ are confined to that helper
- [x] #3 Store tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add allRows(statement, map, ...parameters) and getRow(statement, map, ...parameters) to store/rows.ts, with a Row type (Record<string, unknown>) and a readCount helper for the COUNT(*) AS count lookups. node:sqlite rows (Record<string, SQLOutputValue>) are assignable to Row, so the helper needs no cast.
2. Move every store module (comments, deliveries, followers, inbox, profiles, relays, sessions, state, tokens, webmentions) onto the helpers; mapper functions keep their signatures.
3. Status-count queries keep feeding countByStatus (rows.test.ts fixes its signature); pass statement rows to it without a cast.
4. Replace the JSON-value cast in sessions.ts isFlashMessage with an 'in' narrowing so store/ has no Record<string, unknown> casts left.
5. Grep for the cast, run the store tests, then the full gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
store/rows.ts now has Row (Record<string, unknown>), allRows(statement, map, ...parameters), getRow(statement, map, ...parameters) and readCount(statement, ...parameters). node:sqlite types rows as Record<string, SQLOutputValue>, which is assignable to Row, so the helpers need no cast at all; the old casts were redundant.
All ten store modules read through the helpers, including the dynamically prepared statements in comments.listComments and inbox.listActivitiesAbout. Mappers (toComment, toDelivery, ...) now take Row. Insert-returning reads (logInboxActivity, recordDelivery, recordSentWebmention, putRelay, putFollower) map through getRow and throw on undefined as before. flatMap readers became allRows(...).flat().
Status counts still pass statement.all() rows to countByStatus, whose signature rows.test.ts pins; it is the one place those aggregate rows are read, and it needs no cast either.
listDeletedObjectIds swapped an 'as { object_id: string }[]' cast for String(row['object_id']); the column is TEXT NOT NULL in ap_deliveries.
sessions.ts isFlashMessage narrows a parsed JSON value with 'in' instead of casting it to Record<string, unknown>.
content/sqlite/ has no Record<string, unknown> casts, so it was left alone.
Validation: grep -rc 'as Record<string, unknown>' packages/cms/src/store/ finds 0 (was 42, plus 5 split across lines). pnpm build, pnpm test (cms 7483/7483, all packages green), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. No test file changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added allRows, getRow and readCount (with a Row type) to packages/cms/src/store/rows.ts and moved every store module onto them, so store/ no longer casts rows to Record<string, unknown> anywhere (node:sqlite rows are assignable to Row, so the helpers need no cast). Behaviour preserved; verified with zero cast hits from grep in store/, cms tests 7483/7483 with no test changes, plus test:11ty, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
