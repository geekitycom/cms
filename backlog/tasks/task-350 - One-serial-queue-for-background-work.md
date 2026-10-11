---
id: TASK-350
title: One serial queue for background work
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-32
dependencies:
  - TASK-349
type: chore
ordinal: 309800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At least nine services hand-roll "let chain = Promise.resolve()" plus enqueue and settled logic: federation/delivery.ts, federation/relays.ts, webmention/service.ts, webmention/reply-contexts.ts, mail/service.ts, notify.ts, indexnow.ts, content/sync.ts, plugins/registry.ts. Shutdown depends on every copy settling correctly. mail and indexnow also each write their own retry-with-backoff loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single serial-queue helper provides run, settled and pending, and every hand-rolled chain uses it
- [ ] #2 Tests show settled resolves only after every queued job, including ones queued while draining, and a failing job does not stall the queue
- [ ] #3 mail and indexnow share one retry helper with their existing attempt counts and retry rules
<!-- AC:END -->
