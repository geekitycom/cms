---
id: TASK-381
title: 'A test keeps node:sqlite imports inside the stores'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 12:09'
updated_date: '2026-10-13 16:39'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
priority: medium
type: chore
ordinal: 340800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 keeps a future Aurora build possible by routing every database access through the store interfaces (`ContentStore`, `AdminStore`). Today `node:sqlite` is also imported outside `store/` and `content/sqlite/`: in cache.ts, cli.ts, cms/ and admin/legacy-migrations.ts. Before any of those move, stop the list from growing: a test fails when a source file outside the allowed places imports `node:sqlite`, in the same way layer-boundary.test.ts guards layers. The current exceptions are listed by name in the test, so removing one later is a one-line change and adding one is a visible decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test fails when a non-test source file in packages/cms/src outside store/ and content/sqlite/ imports node:sqlite, and names the file
- [x] #2 Each file that imports node:sqlite outside those places today is listed by name as an exception, and the test fails if a listed exception no longer imports it, so the list only shrinks
- [x] #3 The test is shown to fail on a deliberately added import before it is removed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write packages/cms/src/sqlite-boundary.test.ts in the style of layer-boundary.test.ts and clock-boundary.test.ts: walk non-test .ts under src (skip *.test.ts and __testing__ directories, the same isSource as the other boundary tests; testing.ts is public API and counts as source), match static, type-only and dynamic imports of node:sqlite.
2. Allowed places: store/ and content/sqlite/. EXCEPTIONS lists each other importer by name with a reason: cache.ts, cli.ts, cms/boot.ts, admin/legacy-migrations.ts (verified by grep, no dynamic or __testing__/testing.ts importers).
3. Test 1 fails naming file:line and points to the store interfaces (decision-52); test 2 fails on a listed exception that no longer imports node:sqlite.
4. Prove AC#3 by adding a deliberate import (and a stale exception) and recording the failure output, then remove it.
5. Run pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added packages/cms/src/sqlite-boundary.test.ts, modelled on clock-boundary.test.ts and layer-boundary.test.ts (same readdirSync walk, same isSource, same IMPORT regex as layer-boundary so static, import type, side-effect and dynamic import() all match).

Source file: non-test .ts under packages/cms/src. *.test.ts and any __testing__ directory are skipped, matching the other boundary tests (they are test support). testing.ts is public API and counts as source; it does not import node:sqlite today.

Survey (grep for node:sqlite across src, excluding tests): outside store/ and content/sqlite/ the importers are cache.ts (value import, opens the file and runs migrations), cli.ts (value import, probes database lock before rebuild), cms/boot.ts (import type, passes adminDb to legacy migrations), admin/legacy-migrations.ts (import type, reads/drops tables moved to files). No dynamic imports, none in __testing__ or testing.ts. admin/tools.ts mentions node:sqlite only inside a doc comment in backticks, which the regex does not match.

AC#3 proof: appended to src/notify.ts a static import of node:sqlite (line 229) and a dynamic import('node:sqlite') (line 231), and switched cli.ts's import to a different specifier. Observed output of node --test src/sqlite-boundary.test.ts:
  ✖ is imported only by the stores and the files listed in EXCEPTIONS
  AssertionError [ERR_ASSERTION]: these import node:sqlite outside store/ and content/sqlite/: reach the database through ContentStore or AdminStore instead (decision-52)
  + [ 'notify.ts:229', 'notify.ts:231' ]  - []
  ✖ lists no exception that no longer imports it
  AssertionError [ERR_ASSERTION]: these no longer import node:sqlite: remove them from EXCEPTIONS so the list only shrinks
  + [ 'cli.ts' ]  - []
Both files were restored from copies; git status shows only the new test and the task file.

Validation: pnpm build OK; pnpm test exit 0 (cms 5799/5799 pass, all packages 0 fail); pnpm typecheck, pnpm lint, pnpm format:check OK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added packages/cms/src/sqlite-boundary.test.ts. It walks non-test source under packages/cms/src (skipping *.test.ts and __testing__) and fails, naming file:line and pointing at ContentStore/AdminStore and decision-52, when node:sqlite is imported (static, type-only or dynamic) outside store/ and content/sqlite/. Today's four other importers (cache.ts, cli.ts, cms/boot.ts, admin/legacy-migrations.ts) are listed by name with a reason, and a second test fails when a listed file no longer imports node:sqlite. Verified by a deliberate static + dynamic import in notify.ts and a removed import in cli.ts (both tests failed with the expected messages, then restored), plus pnpm build, test, typecheck, lint and format:check all passing.
<!-- SECTION:FINAL_SUMMARY:END -->
