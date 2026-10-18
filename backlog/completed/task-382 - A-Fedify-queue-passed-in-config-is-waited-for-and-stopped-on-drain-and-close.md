---
id: TASK-382
title: A Fedify queue passed in config is waited for and stopped on drain and close
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 12:10'
updated_date: '2026-10-13 16:31'
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
- [x] #1 A test passes an in-memory Fedify queue through config, queues a delivery, drains the CMS, and shows the delivery is sent before the drain resolves; it fails before the fix
- [x] #2 A test shows a queue passed through config stops listening when the CMS closes
- [x] #3 The default queue keeps its current behaviour, and the existing drain and reload tests still pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: in delivery.test.ts, boot a site with an InProcessMessageQueue passed as config.federation.queue, publish a post, drain, and assert the Create was delivered before drain resolved (fails today). Add a test that the supplied queue's listen() resolves after cms.close() (fails today).
2. Fix in cms/services.ts: wrap every supplied MessageQueue in createSettlingQueue (null stays no queue, undefined gets the default in-process one), so the lifecycle settled/release steps cover it. close() aborts only the listen signal the CMS's federation opened; it disposes nothing the caller owns.
3. Caller-owned queues may be durable (TASK-379): a message left by an earlier process would reach the handler uncounted and drive the pending count negative. Tag each carried message with the settling queue's own id and count only its own; cover with a queue.test.ts case.
4. Run pnpm build, test, typecheck, lint, format:check; check ACs with evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced first: with an InProcessMessageQueue passed as config.federation.queue, drain resolved with no Create sent (saw []) and the supplied queue's listen() never ended after close (the unfixed test run also hung on that live listener until --test-force-exit).

Fix: services.ts now wraps any supplied queue in createSettlingQueue; null still means no queue (Fedify delivers inline), absent still gets the default in-process one. Checked ownership: SettlingQueue.close() only aborts the AbortSignal it hands to inner.listen(), which is the MessageQueue contract for stopping a listener this worker started. It disposes nothing else on the caller's queue, so a durable queue's storage (TASK-379) stays the caller's to close.

Found while checking a caller-owned queue: a durable queue can hand a new worker messages an earlier worker queued. Those reached handled() uncounted, drove pending below zero, and let settled() resolve while the worker's own message was still queued. Carried messages now record which settling queue counted them (a per-instance randomUUID), and only that queue decrements. Covered by a new queue.test.ts case that failed before the change. Envelope shape changed from {counted, message} to {countedBy, message}; nothing persists it today (the default queue is in memory).

Validation: pnpm build, pnpm test (cms 5797/5797, all packages 0 failures), pnpm typecheck, pnpm lint, pnpm format:check all pass. Both new delivery.test.ts cases rerun against HEAD's services.ts fail (saw []; listener never ended within 15 s) and pass with the fix. The default-queue reload test (TASK-288 AC #4) and lifecycle drain tests pass unchanged. The repo's 'wait on events, not on time' test rejects setTimeout in tests, so the close test waits with nextEvent.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A Fedify queue passed through config.federation.queue is now wrapped in createSettlingQueue like the default one, so cms.drain() waits for its queued deliveries and cms.close() aborts this worker's listener on it. null still means inline delivery. SettlingQueue now counts only messages it queued itself (per-instance id on the carried envelope), so a durable queue such as TASK-379's that replays an earlier worker's messages cannot make settled() resolve early. Tests: two in delivery.test.ts (drain sends the delivery; close ends the listener), one in queue.test.ts (leftover messages are not counted), each failing before the change. Full build/test/typecheck/lint/format pass.
<!-- SECTION:FINAL_SUMMARY:END -->
