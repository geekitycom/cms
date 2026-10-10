---
id: TASK-328
title: >-
  The watcher still sometimes misses a document written into a directory created
  under a running watch
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 15:40'
updated_date: '2026-10-10 16:36'
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
- [x] #1 The cause is reproduced (for example with an instrumented watcher under parallel load) and recorded in the notes before the fix
- [x] #2 A document written into a newly created directory, at any depth, under a running watch is indexed without a restart, including when several directories and files appear at once
- [x] #3 The fix does not rely on test-only timing: src/migrated-site.test.ts passes in 10 consecutive full-workspace pnpm test runs
- [x] #4 A regression test fails against the TASK-313 code and passes with the fix
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce under load with a stress harness (scratchpad stress.sh: N concurrent copies of migrated-site.test.ts plus CPU burners), with chokidar instrumented (instrument-chokidar.mjs) and an independent native FSEvents stream (fsevents/trace-fsevents.mjs) to see which layer loses the event.
2. Confirm the mechanism in libuv's fsevents.c.
3. Replace chokidar's per-directory watches with one recursive fs.watch of the content tree, so no new watch is ever added while the site runs; an event naming a non-document path reconciles every document under it (on disk or indexed), which covers directories made, moved or removed.
4. Start order: watch first, confirm it reports changes with a probe directory, then run the boot scan on the same queue as watcher reconciles.
5. Regression test that fails against TASK-313 code (documents written into new directories during the boot scan), a test for several directories at once at any depth plus removal, and drop the sync.test.ts workarounds (pre-created directories, poke rewrites) that existed for the lost events.
6. Verify: stress harness, Linux (node:24 in Docker), full gate, 10 consecutive full-workspace pnpm test runs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduction (AC#1), before any fix, on macOS darwin 25.6, node 24.18, chokidar 5.0.0.
Harness: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/de00b8dd-0b8e-5cc8-a971-3c7d83854e94/scratchpad/stress.sh ROUNDS COPIES BURNERS runs COPIES concurrent copies of src/migrated-site.test.ts per round next to BURNERS busy loops. Baseline 3x8 with 8 burners: 1 of 24 runs failed (the watcher indexed already-announced). With chokidar instrumented (instrument-chokidar.mjs logs fs.watch attaches, raw events, readdir throttling): 1/96 and 3/144. With an extra independent native FSEvents stream on the temp dir (fsevents/trace-fsevents.mjs): 4/144.
What the traces show, in every failure (analyze.mjs over the logs): chokidar attached fs.watch on the content root, the test then made posts/ and wrote its files, and chokidar never received a single raw event for that root; no addDir, so TASK-313's walk never ran. The independent FSEvents stream did see posts/ ItemCreated 13-55 ms after the attach, with no MustScanSubDirs, UserDropped or KernelDropped flag. So macOS reported the change and Node's fs.watch never delivered it. Failures were the first or second watched site in a test process, right after a watcher was opened or closed.
Mechanism (libuv src/unix/fsevents.c): every directory fs.watch in a process shares one FSEventStream. uv__fsevents_init only signals the CoreFoundation thread (no wait), and each add or remove of a directory watch destroys the stream and creates a new one with kFSEventStreamEventIdSinceNow. So fs.watch returns, and chokidar emits ready or attaches a new directory, before macOS reports anything for it, and a change made in that gap is never delivered, for every watched directory, not just the new one. chokidar 5 watches each directory with its own fs.watch, so every new directory under a running watch restarts the stream. TASK-313's walk was a timer after addDir and could not help when addDir itself was lost. Unloaded probes (fsevents/probe.mjs) showed the gap rarely (1 lost warm-up event in ~50 first watches); under the test's load it was 1-3%.

Fix (packages/cms/src/content/sync.ts): chokidar is gone. The content tree is watched by one fs.watch(contentDir, { recursive: true, ignore }), so no watch is added while the site runs and the macOS stream is never restarted under it (FSEvents is recursive itself; Linux uses Node 24's own attach-then-list walker; Windows is native). An event that names a document reconciles it. Any other path may be a directory made, moved or removed, so every document under it, on disk or still indexed, is reconciled (gone ones first, as the scan does). start() now watches first, makes a probe directory (.geekity-watch-<uuid>) in the content root until the watch reports it (250 ms per try, warns after 5 s), removes it, and only then runs the boot scan, on the same queue as watcher reconciles (sync() uses that queue too). A file written at any moment of the boot is found by the scan or reported by the watch. Removed with chokidar: the TASK-313 addDir walk and the chokidar dependency of @geekity/cms. Also removed the nunjucks>chokidar peer rule from pnpm-workspace.yaml and from the pnpm-workspace.yaml that geekity init writes, since nothing supplies chokidar 5 now (cli-init.test.ts updated). In sync.test.ts I removed the workarounds for lost events: watched directories made before the watcher starts, and eventually()'s poke rewrites.
Tests: 'indexes documents written into new directories while the boot scan runs' writes three documents in new nested directories from a created listener during the boot scan. Against the TASK-313 sync.ts it failed 3 of 3 runs ('Timed out waiting for every document written during the boot scan to be indexed'), because chokidar started after the scan with ignoreInitial. With the fix it passes. 'indexes documents in several directories made at once under a running watch, and drops them when a directory goes' writes 12 documents across 3 depths and 2 trees at once, then rm -rf one tree. That test is load-dependent, so it passed against the TASK-313 code when the machine was idle.
Verification: stress.sh 3x8 with 8 burners, 8 loops after the fix: 192 of 192 runs passed. Before the fix the uninstrumented baseline was 1 of 24, and instrumented runs failed 8 of 384. Linux (node:24 in Docker, /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/de00b8dd-0b8e-5cc8-a971-3c7d83854e94/scratchpad/linux.sh): sync.test.ts and migrated-site.test.ts passed 4 of 4 rounds, and the full workspace pnpm test passed (cms 5289/0). A real geekity serve on an empty content dir: mkdir -p of posts/2026/10/deep, pages/new and imported/posts with one document each served 200 within 1 s. After rm -rf imported, /imported-one/ returned 404, and no probe directory was left. The full gate passed: pnpm build, typecheck, lint and format:check. AC#3: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/de00b8dd-0b8e-5cc8-a971-3c7d83854e94/scratchpad/full-runs.sh ran 10 consecutive full-workspace pnpm test runs from the repo root, and all 10 exited 0 in about 108 s each, every package fail 0 (cms pass 5289), with no watcher deadline message. Logs are in /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/de00b8dd-0b8e-5cc8-a971-3c7d83854e94/scratchpad/full-runs/1791648598.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 16:36
---
Orchestrator review: the startup probe made a content directory that cannot be written fail start(). The probe now warns and steps aside when mkdir fails ("starts over a content directory it cannot write to" in sync.test.ts, failing first). Also stressed the new watcher on Linux (node:24 container, 4 copies each of sync.test.ts and migrated-site.test.ts at once beside 4 CPU burners, 8 rounds): 64/64 runs passed.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The content watcher no longer loses documents written into new directories, or written during boot. Root cause: on macOS, every directory fs.watch in a process shares one FSEvents stream. libuv starts that stream asynchronously and restarts it with since-now whenever a directory watch is added. So a change made right after chokidar was ready, or after it attached a new directory, was never delivered. Traces showed macOS reporting posts/ while chokidar received nothing. The fix watches the tree with one recursive fs.watch and reconciles every document under any non-document path an event names. Boot now watches first, confirms with a probe directory that the watch reports changes, then scans. The new boot-scan test fails 3/3 against the TASK-313 code and passes now. The stress harness passed 192/192 (before: 9 failures in 408). Linux in Docker passed. 10 consecutive full-workspace pnpm test runs passed. A served site indexed and dropped new nested directories live.
<!-- SECTION:FINAL_SUMMARY:END -->
