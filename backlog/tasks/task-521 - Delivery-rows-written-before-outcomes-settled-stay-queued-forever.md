---
id: TASK-521
title: Delivery rows written before outcomes settled stay queued forever
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-28T12:13:00Z'
updated_date: '2026-10-28T20:03:00Z'
labels:
  - federation
  - mcp
dependencies: []
priority: low
type: bug
ordinal: 423800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before TASK-516, a queued delivery row was never updated after Fedify took the message, so every row recorded before that release still reads `queued`, and nothing will ever change it. On 2026-10-28 post_federation for hello-world on shll.me showed three Update deliveries to https://me.dm/inbox as queued (2026-09-20, 2026-10-08, 2026-10-09), while federation_status reported the queue empty (waiting 0, retrying 0). A new post published the same day settled to `sent` within a second, so the settling works; only the old rows mislead. TASK-516's description says every delivery andrewshell.org recorded before it is in the same state. Readers of post_federation, the admin post delivery panel and the resend counts cannot tell these rows from deliveries that are genuinely waiting. The outcome of those old sends is unknowable now, so the fix is to say so rather than guess sent or failed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A delivery row left queued from before outcomes were settled, with no message for it in the federation queue, is no longer reported as waiting: it reads as an unknown outcome (a new status or a flag, decided in the plan)
- [ ] #2 A delivery that is genuinely in the queue still reads queued
- [ ] #3 post_federation, the admin delivery view and resend/retry counts agree on the new reading, and retry_deliveries can still resend such a row
- [ ] #4 The change runs on existing data without a manual step, and docs/federation.md describes the reading
- [ ] #5 Tests cover a stale queued row and a live queued row
<!-- AC:END -->
