---
id: TASK-514
title: 'Keep ticket and decision ids out of source comments, enforced by a test'
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
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
- [ ] #1 A test fails when a non-test source file under packages/*/src carries a TASK-NNN, decision-NN or doc-N id in a comment, and its message says to keep the reason and drop the id
- [ ] #2 Existing ids are removed from non-test source comments, keeping the explanation they carried
- [ ] #3 pnpm lint and the full test suite pass
<!-- AC:END -->
