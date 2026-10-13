---
id: TASK-382
title: A Fedify queue passed in config is waited for and stopped on drain and close
status: To Do
assignee: []
created_date: '2026-10-13 12:10'
updated_date: '2026-10-13 12:10'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
priority: high
type: bug
ordinal: 341800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In packages/cms/src/cms/services.ts (around lines 218-226 and 383-389), `federationQueue` is set only when `config.federation.queue` is absent: the CMS wraps its default `InProcessMessageQueue` in `createSettlingQueue` and waits on its `settled()` and calls its `close()` when the site drains or closes. When a site passes its own queue, `federationQueue` is undefined, so a drain under `geekity serve` and a close neither wait for the messages in that queue nor stop its listener. With an in-memory queue passed in, a delivery queued just before a reload can be dropped; with any queue, the old worker may keep listening after it should have stopped. TASK-379 moves federation onto a SQLite queue and will pass one in, so this must hold first. Reproduce before fixing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test passes an in-memory Fedify queue through config, queues a delivery, drains the CMS, and shows the delivery is sent before the drain resolves; it fails before the fix
- [ ] #2 A test shows a queue passed through config stops listening when the CMS closes
- [ ] #3 The default queue keeps its current behaviour, and the existing drain and reload tests still pass
<!-- AC:END -->
