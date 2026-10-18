---
id: TASK-422
title: >-
  A permalink moved away and back on disk always federates its second Create on
  CI
status: To Do
assignee: []
created_date: '2026-10-18 12:51'
labels:
  - tests
  - federation
milestone: m-38
dependencies: []
references:
  - packages/cms/src/federation/delivery.test.ts
  - packages/cms/src/__testing__/wait.ts
  - 'https://github.com/geekitycom/cms/actions/runs/39127669238'
  - backlog/tasks/task-402
priority: medium
type: bug
ordinal: 359800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/federation/delivery.test.ts 'federates under an id it never deleted when it returns to an old permalink' (TASK-417 AC #2) failed on CI for main at 953aa339 (run 39127669238, job test): 'Error: 2 deliveries of a Create never came within 15000 ms'. The site runs in process with watch: true. The test rewrites the post with a new permalink and the first Create arrives; it then rewrites the same file back to the old permalink, and the second Create never came. The same commit passed on test-node-26, and the change under test (#198) touched only docs and an unrelated test. Cause unknown. The log shows only the timeout. One candidate is shared with TASK-402: a file watcher that drops or merges a second quick change to the same file under the slower CI runner (4 vCPUs, test concurrency 3). Others: the second change is indexed but delivery is not enqueued, or the delivery is enqueued but not drained within 15 s on a loaded runner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the wait times out, the error carries what the site saw: the watcher events for the post file, the post's indexed permalink, and the delivery queue's pending and delivered entries
- [ ] #2 The cause of the missed second Create is found and named in the notes, or the test is shown sound with the evidence
- [ ] #3 If the cause is in the product, it is fixed with a test that fails without the fix; if it is the shared watcher cause, TASK-402's notes say so
<!-- AC:END -->
