---
id: TASK-334
title: >-
  The federation screen says which fediverse replies were fetched rather than
  delivered
status: To Do
assignee: []
created_date: '2026-10-10 19:37'
labels:
  - federation
  - admin
dependencies:
  - TASK-321
references:
  - packages/cms/src/federation/backfill.ts
priority: low
type: enhancement
ordinal: 293800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-321 logs replies read from replies collections as inbox lines marked fetched (ap_inbox.fetched). The federation screen lists them with the delivered ones and no label, so an owner cannot tell what the inbox was sent from what the site went and read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The federation screen's inbox list marks a fetched reply as fetched, with where it was read from
- [ ] #2 A delivered reply that replaced a fetched one shows as delivered
- [ ] #3 Admin tests cover both labels
<!-- AC:END -->
