---
id: TASK-371
title: Tests that wait on real time wait on events instead
status: To Do
assignee: []
created_date: '2026-10-12 16:29'
labels: []
milestone: m-37
dependencies: []
priority: medium
type: chore
ordinal: 330800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fourteen test files in packages/cms/src sleep or poll against a wall-clock deadline (for example cli-reload.test.ts, migrated-site.test.ts waiting up to 20 s for the watcher to index a file, and index.test.ts). Under the parallel full run these are the tests that time out: a cli-serve test once timed out under concurrent load and passed alone. Make each one wait for the event it is really waiting for (the watcher or sync announcing a change, the worker reporting ready, a server listening) so the test is as fast as the event and does not fail because the machine is busy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No test file under packages/cms/src waits with a fixed sleep or polls against a Date.now() deadline, except where it measures a duration it asserts on; a check lists any remaining case with its reason
- [ ] #2 Each converted test fails, rather than hanging, if the event never comes (a bounded timeout on the event wait is fine)
- [ ] #3 The full pnpm test run passes three times in a row, and the wall time of the converted files is reported before and after
- [ ] #4 Any seam added to production code for this (an event, a ready signal) is covered by a test of its own
<!-- AC:END -->
