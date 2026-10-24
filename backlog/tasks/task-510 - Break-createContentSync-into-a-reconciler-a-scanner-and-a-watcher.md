---
id: TASK-510
title: 'Break createContentSync into a reconciler, a scanner and a watcher'
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 421800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/content/sync.ts:206 createContentSync is ~326 lines in one closure: indexing, reconciling, scanning, debouncing, a serial queue, settled-listener bookkeeping and watcher startup, all sharing mutable pending/watcher/unsettled state. reconcile returns a boolean that scan decodes into created/updated/unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reconciling one file, scanning the tree and watching for changes are separate units that each own their state
- [ ] #2 reconcile reports a named outcome instead of a boolean
- [ ] #3 Content sync behaves the same: content/sync tests and the dev-mode and watcher tests pass without changes to their assertions
<!-- AC:END -->
