---
id: TASK-4
title: Sync content directory into the index on boot and on file change
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 20:19'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-2
  - TASK-3
references:
  - backlog/docs/doc-1 - Architecture-Overview.md
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the sync model from doc-1: full scan on boot, chokidar watcher with per-path debounce, hash-based no-op detection, removal of index rows whose file vanished, and handling of content/_trash and other underscore directories. Emit typed events (created, updated, deleted, published, unpublished) that later tasks (federation) subscribe to.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Starting the server with a content dir of N posts and M pages indexes N+M documents
- [x] #2 Editing a post file on disk updates its HTML in the index within 2 seconds without restart
- [x] #3 Creating and deleting files on disk adds and removes index rows
- [x] #4 Files under content/_trash and other underscore-prefixed directories are not indexed as public documents
- [x] #5 A write that does not change file content emits no event and performs no index write
- [x] #6 Events carry the previous and next Document so subscribers can detect draft to published transitions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add chokidar 4 to packages/cms dependencies.
2. Write src/content/sync.test.ts first (node:test through tsx): temp content + data dirs, real file writes, bounded waits on a promise-per-event helper.
3. Implement src/content/sync.ts exporting createContentSync({ store, contentDir, watch, debounceMs, logger }): scanning walk of contentDir, syncOnce() full scan, start()/stop() watcher, and a typed emitter.
   - Walk skips underscore-prefixed directories except _trash; only .md/.markdown under a posts/ or pages/ segment become documents; everything else is skipped without throwing.
   - Parse failures are logged through the injected logger and never abort a scan or kill the watcher.
   - Hash no-op detection compares the parsed Document.hash with store.getByPath(path)?.hash; equal means no index write and no event.
   - Boot scan diffs store.listPaths() against the walk and removes rows whose file vanished.
   - chokidar add/change/unlink are debounced per path (default 100 ms) and funneled through the same reconcile function as the scan.
4. Typed events: created, updated, deleted, published, unpublished, each carrying { path, previous, next }. published fires on draft-to-published transitions (create of a published doc, trash-to-live restore); unpublished on the reverse (including delete and move to trash of a published doc).
5. Wire into createCms: new config field watch (default true); createCms builds the sync, exposes cms.events (typed on/off/once) and cms.sync(); serve() runs the boot scan and starts the watcher; close() stops the watcher before closing the store. Optional onDocumentChange config hook subscribes at construction.
6. Export the sync types from src/content/index.ts and src/index.ts; update README with the sync model, the events API and the watch config field.
7. Verify: pnpm test, pnpm typecheck, pnpm build, then pnpm dev against apps/demo, edit a content file live, confirm the index row updates, restore the file, stop the server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in packages/cms/src/content/sync.ts (createContentSync) and wired into createCms.

Design decisions:
- Documents are Markdown (.md/.markdown) under a posts/ or pages/ directory. The walk skips underscore- and dot-prefixed directories and node_modules, with one exception: _trash/ is walked, so trashed documents stay indexed (the store already derives trashed from the path) and out of every public listing. _data/ is never indexed.
- Hash no-op detection compares the parsed Document.hash with store.getByPath(path)?.hash. Equal means no upsert and no event, which is what makes an admin write (file + direct upsert) cost one index write rather than two.
- A full scan drops rows whose file has gone BEFORE it writes the files it found. A rename - which trashing and restoring are - would otherwise collide with its own old row over the shared permalink. The watcher cannot order unlink before add, so upsert also retries once on DuplicatePermalinkError when the conflicting row's file is no longer on disk, dropping the stale row and emitting its deleted event. Verified by 'follows a post moved into the trash, whichever event arrives first'.
- Parse and index failures are logged through an injected logger (defaults to console) and counted in SyncResult.failed. Neither a scan nor the watcher stops, and the failed file's old row is left alone.
- Watcher events are debounced per path (default 100 ms, DEFAULT_DEBOUNCE_MS) and then applied through one serial queue, so two files that change together never interleave their index writes.
- Events: created, updated, deleted, published, unpublished, plus the catch-all change. Each carries previous, next, path and origin ('scan' or 'watch'). published/unpublished are derived from visibility (exists && !draft && !trashed), so trash-to-live and live-to-trash fall out of the same rule. A listener that throws is logged and does not stop the sync. on() returns the unsubscribe.

Public API added: cms.events, cms.sync(), createContentSync, and the config field watch (default true, env GEEKITY_WATCH). serve() now runs the boot scan and starts the watcher before it listens; close() stops the watcher first.

Dependency: chokidar 5.0.0, not 4. v5 is the current major (Nov 2025): same API, ESM-only, node >= 20.19, one dependency (readdirp). The workspace is ESM on node >= 22.5, so v4 would have been the older release with no benefit.

Test flakiness note: macOS drops a filesystem event roughly once in 35 full-suite runs. Reproduced with plain chokidar and no CMS code (10 concurrent watchers on fresh temp dirs lose events entirely). Handled in the test file, not the product: each test's watcher is stopped in afterEach rather than at the end of the file, and the watcher waits re-write the file while polling, so a dropped notification is asked for again while a watcher that is genuinely not listening still fails. 50 consecutive clean full-suite runs after that.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added packages/cms/src/content/sync.ts: a full scan of the content directory plus a chokidar 5 watcher with a 100 ms per-path debounce, hash-based no-op detection, removal of index rows whose file has gone, and typed created/updated/deleted/published/unpublished/change events carrying the document before and after. createCms now exposes cms.events and cms.sync(), runs the boot scan and starts the watcher inside serve(), stops the watcher in close(), and honours a new config field watch (default true, env GEEKITY_WATCH). Both READMEs and the site config template document it.

Verified with 28 new node:test cases in sync.test.ts, 5 in index.test.ts and 3 in config.test.ts: pnpm test 150/150 pass, pnpm typecheck and pnpm build clean, and 50 consecutive full-suite runs with no failures. Verified live against apps/demo (GEEKITY_PORT=3999, port 3000 was taken): the boot scan indexed pages/about.md; appending a line to it updated the indexed HTML within 2 seconds with no restart (one 'demo site listening' line in the log); creating content/posts/2026-09-02-watcher-check.md added its row; moving it to content/_trash/posts/ flipped the row to trashed=1 and dropped the live one; deleting it removed the row. The demo file was restored byte-for-byte and the server stopped.
<!-- SECTION:FINAL_SUMMARY:END -->
