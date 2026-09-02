---
id: TASK-4
title: Sync content directory into the index on boot and on file change
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
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
- [ ] #1 Starting the server with a content dir of N posts and M pages indexes N+M documents
- [ ] #2 Editing a post file on disk updates its HTML in the index within 2 seconds without restart
- [ ] #3 Creating and deleting files on disk adds and removes index rows
- [ ] #4 Files under content/_trash and other underscore-prefixed directories are not indexed as public documents
- [ ] #5 A write that does not change file content emits no event and performs no index write
- [ ] #6 Events carry the previous and next Document so subscribers can detect draft to published transitions
<!-- AC:END -->
