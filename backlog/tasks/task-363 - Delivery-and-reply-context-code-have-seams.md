---
id: TASK-363
title: Delivery and reply-context code have seams
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-35
dependencies:
  - TASK-362
type: chore
ordinal: 322800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
federation/delivery.ts createDeliveryService is a 500-line closure whose stamp, target and fan-out logic share closure state. webmention/reply-context.ts (890 lines) puts page fetch, microformats, JSON-LD, oEmbed and fediverse lookups in one file, with known oEmbed endpoints as code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Delivery target selection, stamping and fan-out are pure functions tested directly
- [ ] #2 Reply-context sources live in one module each, joined only by merge
- [ ] #3 Known oEmbed endpoints are a data table
- [ ] #4 Federation and reply-context tests pass unchanged
<!-- AC:END -->
