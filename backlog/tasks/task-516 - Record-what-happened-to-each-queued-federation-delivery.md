---
id: TASK-516
title: Record what happened to each queued federation delivery
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24T19:39:00Z'
updated_date: '2026-10-24T20:00:00Z'
labels:
  - federation
dependencies: []
priority: high
type: bug
ordinal: 418800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the message queue on, which is the default, a delivery row is written as `queued` when the activity is handed to Fedify, and nothing ever updates it. Every delivery andrewshell.org has recorded is still `queued`. The admin cannot tell a post that reached an inbox from one Fedify retried and gave up on. The relay Follow is not recorded at all. On 2026-10-24 the tags.pub relay on andrewshell.org had been "Waiting" for five days with "Nothing yet" beside it. Its Follow had failed (tags.pub could not read the actor key before 0.42.1) and its retries had run out, and the screen gave no sign. Fedify has no success callback. It calls `onOutboxError` on each failed attempt and enqueues its retries through the site's queue, so the queue is where an outcome can be observed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a queue, a delivery the inbox accepts ends as `sent` on every follower row that shares that inbox
- [x] #2 A failed attempt that Fedify will retry leaves the rows `retrying` with the error, so the screen shows why it is retrying
- [x] #3 A delivery Fedify gives up on, after its retries or on a permanent status such as 410, ends as `failed` with the error
- [x] #4 A relay Follow and Undo are recorded as deliveries to the relay, so the relay row's Last delivery shows how the Follow went, including its error
- [x] #5 Outcomes are settled even when the queue worker handles a message before the row would otherwise have been written
- [x] #6 The synchronous path (queue: null) and dev-mode holds behave as before
- [x] #7 Tests cover sent, retrying, gave-up and permanent failure through a real Fedify federation and queue; docs/federation.md describes the statuses as they now behave
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Queue observer (federation/outbox-observer.ts) runs each outbox message inside an AsyncLocalStorage frame; onOutboxError and the permanent-failure handler write the error; an enqueue of the same activity and inbox marks a retry. 2. Settle sent/queued/retrying/failed onto every ap_deliveries row for that activity and inbox. 3. fanOut and relay send write the queued row before handing off. 4. Relay Follow/Undo recorded against the relay inbox. 5. Docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built by a delegate, reviewed and extended here. Departures: a retry with no error (circuit-breaker hold) stays `queued`; the permanent-failure handler also feeds the frame because a circuit TTL drop never calls onOutboxError; comment review led to a real `retrying` status instead of queued-plus-error, and to guarding the settle write so a store error never escapes into the queue worker (for the default SQLite queue that would only be a logged error; for a supplied queue with native retrial it would resend). Tests: 7520/7520, lint, typecheck clean. Integration tests run the real CMS with queue.sqlite against a stubbed peer for 202, 503, 410 and an exhausted retry policy, and a relay Follow refused with 410.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Queued federation deliveries now settle. A queue observer watches each outbox message Fedify handles and writes the outcome onto the delivery rows for that activity and inbox: `sent` when the inbox accepted it, `retrying` with the error when Fedify will try again, `failed` with the error when it gave up (retries exhausted, 404/410, or a circuit-breaker drop). Rows are written as `queued` before the hand-off so a fast worker always has a row to settle. Relay Follow and Undo are now recorded as deliveries, so a relay stuck at Waiting shows why on its row. `retrying` is a new DeliveryStatus value. To confirm in production after deploy: new rows on andrewshell.org should reach `sent` within seconds instead of staying `queued`. Existing rows stay `queued`; they predate the observer.
<!-- SECTION:FINAL_SUMMARY:END -->
