---
id: TASK-511
title: Split createSupervisor state into a plugin watcher and a reload queue
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 422800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/supervisor/primary.ts:100 createSupervisor is ~262 lines with about 12 let variables (loaded, reloading, failed, waiting, queued, seen, compared, changing, ...) in one closure; look() mixes signature debounce, logging and reload triggering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plugin change detection and reload sequencing are separate units with their own state and intention-revealing names
- [ ] #2 Supervisor behaviour is the same: supervisor and cli-reload tests pass without changes to their assertions
<!-- AC:END -->
