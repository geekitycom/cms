---
id: TASK-403
title: >-
  Data classes: every core data file is declared and its path is built through
  the declaration
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 359800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace `DataClass` with the tagged union of section 1. Add `files/data-files.ts` with one declaration per core row of the Context table, `queue.sqlite` as `pending` included, and `dataPath`. Move every `dataDir` join site onto it. Update the five settings namespaces and the folder storage. Change `dev_mode` to `kept`.

From decision-55 (accepted), proposed task 1. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `DataClass` is the union of section 1, and every `switch` on it is exhaustive.
- [ ] #2 Every core file and folder in the table has a declaration with its class and a `lost` sentence. `queue.sqlite` and its WAL files are `pending`.
- [ ] #3 `data-files-boundary.test.ts` uses the TypeScript AST, fails on a `dataDir` join outside the allowed modules, and names the file, the line and the fix. It is shown to fail on a call added on purpose before that call is removed.
- [ ] #4 A test pins the scratch patterns to `files/atomic.ts` `temporaryName` and `jobs/lock-file.ts`.
- [ ] #5 A test asserts that every file `discardDatabase` removes is declared `rebuildable`.
- [ ] #6 The settings registry writes mode 0600 exactly where it does today.
<!-- AC:END -->
