---
id: TASK-381
title: 'A test keeps node:sqlite imports inside the stores'
status: To Do
assignee: []
created_date: '2026-10-13 12:09'
updated_date: '2026-10-13 12:10'
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
- [ ] #1 A test fails when a non-test source file in packages/cms/src outside store/ and content/sqlite/ imports node:sqlite, and names the file
- [ ] #2 Each file that imports node:sqlite outside those places today is listed by name as an exception, and the test fails if a listed exception no longer imports it, so the list only shrinks
- [ ] #3 The test is shown to fail on a deliberately added import before it is removed
<!-- AC:END -->
