---
id: TASK-510
title: 'Break createContentSync into a reconciler, a scanner and a watcher'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 12:37'
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
- [x] #1 Reconciling one file, scanning the tree and watching for changes are separate units that each own their state
- [x] #2 reconcile reports a named outcome instead of a boolean
- [x] #3 Content sync behaves the same: content/sync tests and the dev-mode and watcher tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the sync, schedule, write, dev-mode, watcher, boot and boundary tests are green (run 3x).
2. content/content-tree.ts: the walk and its rules (walk, isWalkableDirectory, isDocumentPath), shared by scanner, watcher and reconciler.
3. content/reconcile.ts: createReconciler({ store, contentDir, logger, emit }) owning the handle directory, with reconcile(path, origin) returning a named ReconcileOutcome ('created' | 'updated' | 'deleted' | 'unchanged' | 'skipped') instead of a boolean plus a thrown SkippedFile; the stale-permalink retry moves with it.
4. content/scan.ts: scanContent (the full walk, tallying outcomes into SyncResult exactly as before) and documentsUnder.
5. content/content-watcher.ts: createContentWatcher owning the tree watcher, the per-path debounce map and the probe; it hands a settled path to a callback and reports how many paths are still waiting out their debounce.
6. sync.ts keeps the public types, the emitter, the serial queue and the settled listeners, and wires the units together with ordering unchanged (debounce -> queue.run -> reconcile -> settle when the queue and debounce map are empty).
7. Update the clock-boundary allowance file path for the probe's Date.now lines (moved, not changed).
8. Rerun the targeted tests 3x, then the full verification suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split createContentSync (326 lines) into units that each own their state:
- content/content-tree.ts: walk, isWalkableDirectory, isDocumentPath (stateless, shared).
- content/reconcile.ts: createReconciler owns the handle directory and the stale-permalink retry; reconcile returns ReconcileOutcome ('created' | 'updated' | 'deleted' | 'unchanged' | 'skipped'). The SkippedFile exception class is gone: a logged parse or index failure is the 'skipped' outcome, and any other error still throws as before.
- content/scan.ts: scanContent tallies outcomes into SyncResult exactly as the boolean did (a gone row that changed counts removed; on disk, created/updated/unchanged/failed, and a file that vanished between walk and read still counts updated); documentsUnder moved here.
- content/content-watcher.ts: createContentWatcher owns the TreeWatcher, the per-path debounce map and the probe, and exposes start/stop/waiting.
- sync.ts keeps the public types, the emitter, the serial queue and a small createSettledListeners, and wires the units. Ordering is unchanged: debounce fires -> pending entry deleted -> queue.run(reconcileWatched) -> settle when unsettled, no path waits and this run is the last in the queue. stop() still cancels debounces and closes the watch before awaiting queue.settled().
- clock-boundary.test.ts: the two probe Date.now allowances now name content/content-watcher.ts (the lines moved unchanged; no assertion changed).
Function lengths: createContentSync 326 -> 80, longest new is createReconciler at 83.
Validation: content, dev-mode, watcher, boot and boundary tests (729) green 3x before and after; pnpm build, test (cms 7481/7481), test:11ty, typecheck, lint, format:check pass. One full-suite run hit a timeout in cli-jobs.test.ts (TASK-400 AC #2, reload job worker); it passed twice alone and in the next full run, and does not touch content sync.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Broke createContentSync into a reconciler (content/reconcile.ts, named ReconcileOutcome instead of a boolean plus a thrown SkippedFile), a scanner (content/scan.ts), a watcher (content/content-watcher.ts, owning the debounce map, tree watch and probe) and shared walk rules (content/content-tree.ts); sync.ts composes them with the serial queue and settled listeners, preserving ordering. Verified with the content/dev-mode/watcher/boot/boundary tests 3x and pnpm build, test (7481 pass), test:11ty, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
