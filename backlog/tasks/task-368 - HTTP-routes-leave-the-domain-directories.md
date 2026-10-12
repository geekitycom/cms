---
id: TASK-368
title: HTTP routes leave the domain directories
status: To Do
assignee: []
created_date: '2026-10-12 11:31'
labels: []
milestone: m-36
dependencies:
  - TASK-366
priority: medium
type: chore
ordinal: 327800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hono route files sit inside feature directories: comments/routes.ts, comments/viewer.ts, webmention/routes.ts, webmention/pingback.ts and federation/mount.ts. That ties those features to the HTTP framework. Keep the features as plain functions over requests the delivery layer has already parsed, and move the Hono wiring into the delivery layer named by the layer map.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No non-test module under comments/, webmention/ or federation/ imports hono
- [ ] #2 The layer-map check from the previous task enforces this
- [ ] #3 Routes, status codes and responses are unchanged; existing route tests pass
<!-- AC:END -->
