---
id: TASK-513
title: Map store rows through one typed helper
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
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
- [ ] #1 Store modules read rows through a shared helper that takes a statement and a mapper
- [ ] #2 as Record<string, unknown> row casts in store/ are confined to that helper
- [ ] #3 Store tests pass without changes to their assertions
<!-- AC:END -->
