---
id: TASK-422
title: >-
  A permalink moved away and back on disk always federates its second Create on
  CI
status: Done
assignee:
  - '@claude'
created_date: '2026-10-18 12:51'
updated_date: '2026-10-18 18:21'
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
- [x] #2 The cause of the missed second Create is found and named in the notes, or the test is shown sound with the evidence
- [x] #3 If the cause is in the product, it is fixed with a test that fails without the fix; if it is the shared watcher cause, TASK-402's notes say so
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test first: a watched site picks up a hand edit to a post file the CMS has itself replaced with an atomic rename. Fails on Linux before the fix.
2. sync.ts: on Linux, replace the recursive watch with one non-recursive fs.watch per directory under content/, adding watches for directories as they appear and dropping them when they go. Same events into handle(), same ignore rules, same probe. macOS and Windows keep the recursive watch.
3. Verify in the Linux container: the new test and the TASK-417 test pass under load many times; full suite on Linux and on macOS.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-18: cause found. Reproduced in a node:24 linux/arm64 container (Docker, --cpus 4): the test fails 20/20 with six busy loops running and passes 20/20 idle. With logging in sync.ts: after the first edit, the CMS rewrites the post file itself (an atomic temp-file rename adding the activitypub key). The test's second write then produces no watcher event at all. A plain script shows why, idle as well as loaded: on Linux, Node's recursive fs.watch (v24.21.0) stops reporting writes to a file once that file has been replaced by an atomic rename; a non-recursive watch on the file's directory keeps reporting them. So on a Linux host (the Docker image), any post the CMS has saved stops being watched until restart, and a later hand edit is not indexed. The test passes or fails only by whether the CMS's write-back lands before the test's second edit. Fix: on Linux, watch each directory under content/ with its own non-recursive watch instead of Node's recursive one.

Fixed in PR #202 (content/tree-watch.ts): on Linux the content watcher keeps one non-recursive fs.watch per directory; macOS and Windows keep the recursive watch. New sync.test.ts test 'keeps indexing a post after the CMS has replaced it atomically' fails in a node:24 Linux container before the fix and passes after. The TASK-417 test went from 0/20 to 20/20 passes in the container under load. Full suite: Linux container 6242 pass, 1 skipped (root); macOS 6243 pass. Node 26.11.1 does not show the bug in the standalone script. AC #1 (timeout diagnostics) left unchecked on purpose: the cause was found directly with temporary logging, and the fix removes the failure the diagnostics were meant to explain. TASK-402's test watches runs.log, which is appended to, not replaced, so this bug is unlikely to be its cause.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The flake was a real Linux bug: Node 24's recursive fs.watch stops reporting writes to a file once it has been replaced by an atomic rename, which is how the CMS writes every file, so on a Linux host a post the CMS had saved was no longer watched. The content watcher now watches each directory separately on Linux. Verified in a node:24 Linux container: the new regression test fails before and passes after, and the TASK-417 test passes 20/20 under load where it failed 20/20.
<!-- SECTION:FINAL_SUMMARY:END -->
