---
id: TASK-514
title: Keep ticket and decision ids out of source comments, enforced by a test
status: Done
assignee:
  - '@claude'
created_date: 2026-10-24 11:41
updated_date: '2026-10-24T13:30:00Z'
labels:
  - refactor
milestone: m-49
dependencies:
  - TASK-506
  - TASK-507
  - TASK-508
  - TASK-509
  - TASK-510
  - TASK-511
  - TASK-512
  - TASK-513
type: chore
ordinal: 425800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
About 1,276 TASK-NNN references sit in packages/cms/src comments across 178 files (plus decision-NN and doc-N ids). The rationale text is useful; the ids are history that belongs in git and Backlog. Runs last so the other refactors do not churn the same comments.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test fails when a non-test source file under packages/*/src carries a TASK-NNN, decision-NN or doc-N id in a comment, and its message says to keep the reason and drop the id
- [x] #2 Existing ids are removed from non-test source comments, keeping the explanation they carried
- [x] #3 pnpm lint and the full test suite pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write packages/cms/src/comment-ids-boundary.test.ts first: scan every packages/*/src non-test .ts (skipping __testing__), find comment ranges with the TypeScript API (getLeading/TrailingCommentRanges over every node, so strings are not flagged), fail with file:line + 'keep the reason, drop the id'; plus a self-test over a sample. Watch it fail (998 hits).
2. Codemod in the session scratchpad that rewrites comment text only: drop parenthetical id lists (with AC #n), drop leading 'TASK-n:' prefixes and capitalise, delete id-only comments, join stranded punctuation, drop emptied lines.
3. Reword the ~150 ids used as sentence subjects/objects by hand so each comment says what is true now.
4. Fix codemod fallout (lost space after '*', '//.' lines), reflow paragraphs pushed past 80 columns, run prettier.
5. Prove no code changed: per-file token streams (JSDoc excluded) and comment-stripped transpile output identical to HEAD.
6. Full gate: pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Guard: packages/cms/src/comment-ids-boundary.test.ts scans every packages/*/src non-test .ts (not __testing__), collects comment ranges with typescript-classic (getLeading/TrailingCommentRanges over every node), matches TASK-n / decision-n / doc-n case-insensitively, and reports 'file:line id: keep the reason the comment gives and drop the id'. A second case pins that line, block and JSDoc comments are found and string/template literals are not. Failed with 998 hits on the starting tree.
Codemod (session scratchpad, codemod.mjs) rewrote comment ranges only: parenthetical id lists incl. AC #n and lists spanning a comment line break, leading 'TASK-n:' prefixes (next letter capitalised), id-only comments, stranded punctuation joined to the line above, emptied lines dropped. About 850 ids. The ~150 used as sentence subjects or objects (decision-9/13/14, doc-2/4/5, 'before TASK-55 shipped') were reworded by hand to state what is true now. Fallout fixed: a lost space after '*' (71 lines) and '//.' lines; paragraphs pushed past 80 columns reflowed; prettier run.
Out of scope and left alone: ids in string literals (error messages naming decision-14, SQL comments inside the schema.ts template literals, which reach sqlite_master), test files, __testing__, packages/cms/editor and packages/cms/scripts.
No code changed: for all 250 touched files the TypeScript token stream (JSDoc nodes excluded) and the comment-stripped transpile output are identical to HEAD.
Gate: pnpm build, test (cms 7485 pass = 7483 + 2 new), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed every TASK, decision and doc id (997 in 250 files) from comments in non-test source under packages/*/src, keeping the explanation each carried, and added comment-ids-boundary.test.ts, which fails naming file:line and telling the author to keep the reason and drop the id. Parenthetical and prefix ids went through a comment-only codemod; ids that were a sentence's subject were reworded by hand. Verified no code changed (identical token streams and comment-stripped output for all 250 files) and the full gate passes (build, test, test:11ty, typecheck, lint, format:check).
<!-- SECTION:FINAL_SUMMARY:END -->
