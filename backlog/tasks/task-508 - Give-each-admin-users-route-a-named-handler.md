---
id: TASK-508
title: Give each admin users route a named handler
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 419800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/admin/users.ts:180 mountUsers is ~344 lines registering 9 routes whose handlers each parse, validate, save, flash and redirect. The flash-then-redirect tail repeats about 7 times and the target-user lookup plus instanceof Response guard repeats in several handlers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 mountUsers only wires routes to named handler functions
- [ ] #2 Flash-and-redirect and loading the target user each go through one shared helper
- [ ] #3 Admin users screens behave the same: admin/users tests pass without changes to their assertions
<!-- AC:END -->
