---
id: TASK-328
title: >-
  The watcher still sometimes misses a document written into a directory created
  under a running watch
status: To Do
assignee: []
created_date: '2026-10-10 15:40'
labels:
  - content
  - bug
dependencies: []
references:
  - packages/cms/src/content/sync.ts
  - packages/cms/src/migrated-site.test.ts
priority: high
type: bug
ordinal: 287800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-313 (398e7b3, fix(cms): index a document written into a directory created under a running watch) did not close the gap. On branch comment-threads-and-feeds, a full-workspace pnpm test failed 2 of 7 runs in src/migrated-site.test.ts with "the watcher indexed …" after its 20 s deadline, in two different tests ("is announced, mentioned, pinged and submitted when its file is written" and "sends nothing for a post its followers already hold, nor for one never federated"). Both write a file with mkdir -p then writeFile under a running watch. Each passes alone and in the cms package run, so it appears under load. A 20 s miss means the add event was dropped, not late. A document that is never indexed stays off the site until the next boot scan, so this is a product gap, not only a flaky test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The cause is reproduced (for example with an instrumented watcher under parallel load) and recorded in the notes before the fix
- [ ] #2 A document written into a newly created directory, at any depth, under a running watch is indexed without a restart, including when several directories and files appear at once
- [ ] #3 The fix does not rely on test-only timing: src/migrated-site.test.ts passes in 10 consecutive full-workspace pnpm test runs
- [ ] #4 A regression test fails against the TASK-313 code and passes with the fix
<!-- AC:END -->
