---
id: TASK-356
title: 'createCms is a list of services, not one long function'
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-34
dependencies:
  - TASK-355
type: chore
ordinal: 315800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createCms in index.ts is about 770 lines: boot migrations, about 30 services, middleware and mounts, lifecycle and the public object. Start, stop and settle are three hand-kept lists that must agree; a missed settled() loses queued work at shutdown. 8 content change subscriptions are ordered only by file position. cited: (url) => replyContexts.read(url) is repeated 6 times, and the federation context literal is built twice. index.ts is also a 1400-line export barrel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Services share one lifecycle shape and one ordered list drives start, stop, settle and drain
- [ ] #2 Content change subscribers are declared in one ordered list
- [ ] #3 The federation context is built once and shared dependencies are passed as one object
- [ ] #4 Boot migrations, service construction and app assembly are separate modules; the public exports live in their own module
- [ ] #5 A test shows close() waits for every service queue
<!-- AC:END -->
