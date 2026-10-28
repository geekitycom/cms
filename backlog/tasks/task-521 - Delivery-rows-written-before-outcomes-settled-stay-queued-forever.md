---
id: TASK-521
title: Delivery rows written before outcomes settled stay queued forever
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T12:13:00Z'
updated_date: '2026-10-28T20:17:00Z'
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
- [x] #1 A delivery row left queued from before outcomes were settled, with no message for it in the federation queue, is no longer reported as waiting: it reads as an unknown outcome (a new status or a flag, decided in the plan)
- [x] #2 A delivery that is genuinely in the queue still reads queued
- [x] #3 post_federation, the admin delivery view and resend/retry counts agree on the new reading, and retry_deliveries can still resend such a row
- [x] #4 The change runs on existing data without a manual step, and docs/federation.md describes the reading
- [x] #5 Tests cover a stale queued row and a live queued row
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New delivery status unknown. 2. Read the deliveries the SQLite queue still carries (outbox inbox, every fanout inbox). 3. A lifecycle step that runs before anything sends marks queued/retrying rows with no waiting message unknown; queue: null marks all; a supplied queue is left alone. 4. retry_deliveries treats unknown like failed. 5. Admin Sent column counts unknown. 6. Docs.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivery rows written before 0.43.0, or lost by the queue, no longer read as waiting forever. A new status, unknown, marks a queued or retrying row with no message for it in data/queue.sqlite. The check runs as the first lifecycle step when the server starts, before anything can send, so a row written just before its message is enqueued is never caught. With federation.queue: null every such row becomes unknown; a queue the site supplies cannot be read, so its rows are left alone. retry_deliveries resends unknown rows like failed ones, and sends the Create when the recipient's newest Create is unknown. post_federation and the inspect counts carry the new status, and the federation screen's Sent column reads like '0, 3 outcome unknown'. docs/federation.md and docs/mcp.md describe it. Tests: store marking (stale, live, settled, newer than the cutoff), the queue reader against a real SqliteMessageQueue (outbox, fanout, other messages), a booted CMS with a stale row and a delayed waiting message, queue: null, retry selection, admin rendering. Full suite 7717/7717, lint and typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
