---
id: TASK-313
title: >-
  A document written into a directory created under a running watch is never
  indexed
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 21:18'
updated_date: '2026-10-09 21:25'
labels:
  - bug
milestone: m-31
dependencies: []
priority: medium
type: bug
ordinal: 272800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Under geekity serve, chokidar can miss a document written into a directory it has only just seen appear: the first file in a new posts/ directory is reported and the second never is. The file stays out of the index until the next boot scan. CI on PR #153 hit it (migrated-site.test.ts, 'the watcher indexed an-old-essay' after 20s), and the cms suite on Linux arm64 node 24 reproduced it in 2 of 6 full runs with an instrumented watcher showing no add event for the second file. sync.test.ts already worked around it in tests by creating every watched directory before watching. An import into a running site can create new directories, so this is a product gap, not a test one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a directory appears under a running watch, every document in it is reconciled, whether or not chokidar reported each file
- [x] #2 A document chokidar did report is not reconciled into a second change (reconcile of an unchanged file stays a no-op)
- [x] #3 The cms suite passes repeatedly on Linux arm64 node 24, the platform CI failed on
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. On chokidar's addDir, after the debounce, walk the new directory (walk() gains a content-relative start) and pass each document through the same per-path debounced handle(), so a file chokidar dropped is reconciled and one it reported merges into a no-op.
2. Prove on Linux arm64 node 24: loop the full cms suite, which failed 2 of 6 before the fix.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: chokidar reports a directory created under a live watch, then attaches its own watch; a file written in that gap is never reported. Instrumented run on Linux arm64 node 24 showed an add event for the first post in a new posts/ directory and none for the second. Fix in packages/cms/src/content/sync.ts: on addDir, after the debounce, walk that directory (walk() takes a content-relative start) and pass each document through handle(), the same per-path debounce, so a reported file merges and reconcile of an unchanged file returns early on its hash. A walk that finishes after stop() queues nothing. Evidence: full cms suite on Linux arm64 node 24 failed 2 of 6 runs before (migrated-site 'the watcher indexed an-old-essay'), passed 8 of 8 after. sync.test.ts and migrated-site.test.ts pass locally (39/39); full gate passes. No new unit test: the miss depends on kernel timing and macOS also drops directory events, so a direct test would be flaky either way; the existing watcher tests in migrated-site and plugin-wordpress import-dev-mode are the ones that hit it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A document written into a directory that appears under a running watch is now indexed even when chokidar never reports it: the watcher walks each new directory once its own watch is in place. This fixed the PR #153 CI failure, which was this race and not load: before, 2 of 6 full cms runs on Linux arm64 node 24 failed; after, 8 of 8 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
