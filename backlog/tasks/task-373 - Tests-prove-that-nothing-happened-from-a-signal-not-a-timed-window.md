---
id: TASK-373
title: 'Tests prove that nothing happened from a signal, not a timed window'
status: To Do
assignee: []
created_date: '2026-10-12 17:49'
labels: []
milestone: m-37
dependencies:
  - TASK-371
priority: high
type: chore
ordinal: 332800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-371, packages/cms/src/test-waits.test.ts still allows timed windows that make the suite slow: cli-reload.test.ts waits poll + settle + 2 s (about 8 s) to show the supervisor leaves a failed plugins folder alone and runs a 3 s slow hand copy; index.test.ts and content/sync.test.ts wait 500 ms to show no event comes with the watcher off or after close; drain.test.ts waits 400 ms (drained watcher) and 50 ms (drain still waiting for a write); web/moved-identity.test.ts puts a 40 ms gap between two writes inside one debounce. The user wants every such wait replaced, because the suite takes a very long time to run. Give each case a signal to wait on instead: a log line or event when the supervisor skips a folder, a closed/stopped state the watcher reports, a debounce the test can drive directly, or a fake clock where the code already takes one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 test-waits.test.ts allows only duration measurements, the bound inside the shared wait helper, and code inside strings; every absence window and scenario timer is gone from its list
- [ ] #2 Each converted test still fails when the behaviour it guards breaks (prove it with a planted regression per case, then revert)
- [ ] #3 Any production signal added for this has a test of its own and follows the layer map
- [ ] #4 Wall time of each converted test file, run alone, is reported before and after
<!-- AC:END -->
