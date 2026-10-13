---
id: TASK-350
title: One serial queue for background work
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 18:01'
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
- [x] #1 A single serial-queue helper provides run, settled and pending, and every hand-rolled chain uses it
- [x] #2 Tests show settled resolves only after every queued job, including ones queued while draining, and a failing job does not stall the queue
- [x] #3 mail and indexnow share one retry helper with their existing attempt counts and retry rules
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add util/queue.ts (createSerialQueue: run, settled, pending) and util/retry.ts (retry with attempts, backoffMs, injectable wait), tests first.
2. Replace the chains in notify, indexnow, mail, federation/delivery, federation/relays, webmention/service (sends and incoming checks), webmention/reply-contexts, content/sync (pending replaces the queued counter), plugins/registry, the sweep chains in privacy/retention, federation/profiles, federation/backfill, avatars/avatars, and the per-path lock in files/atomic (one queue per path); run each service's tests after.
3. Move mail's and indexnow's retry loops onto util/retry.ts, keeping attempt counts, the indexnow no-retry-on-4xx rule and the injectable waits.
4. Leave content/schedule.ts and notifications/digest.ts (they track the last run, they do not chain) and supervisor/primary.ts (reload coalescing).
5. pnpm build, test, typecheck, lint, format:check; grep for leftover chains.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
util/queue.ts: createSerialQueue() gives run(job), settled() and pending(). settled() loops while pending() > 0, so jobs queued while it drains are covered; a rejected job rejects only its own run() promise. util/retry.ts: retry({attempts, backoffMs, wait?}, attemptOnce) where each try answers {value, retry}; fewer than one attempt still tries once; no wait after the last try; default wait resolves at once for ms <= 0.
Converted beyond the nine named: privacy/retention, federation/profiles, federation/backfill and avatars/avatars each had a sweeping.then(sweepOnce) chain, and files/atomic's per-path lock is now a Map of SerialQueues (the entry is dropped when pending() reaches 0). content/schedule and notifications/digest keep a single last-run promise rather than a chain, so they stay.
Behaviour changes: every settled() now also waits for jobs queued while it drains (before, it waited on the chain as it stood at the call). plugins/registry no longer stalls if a step rejects (lifecycle already caught errors, so not observable today). indexnow with attempts <= 0 now tries once instead of sending nothing (mail already clamped to 1).
Validation: pnpm build, pnpm test (cms 5532 pass, plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. The draining test fails when settled() is reverted to a single await of the tail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added util/queue.ts (createSerialQueue: run, settled, pending) and util/retry.ts (retry with injectable wait), with tests. Every hand-rolled promise chain now uses the queue: notify, indexnow, mail, federation delivery and relays, webmention sends and incoming checks, reply contexts, content sync, the plugin registry, the retention, profile, backfill and avatar sweeps, and the per-path write lock in files/atomic. mail and indexnow share retry() with their attempt counts and the indexnow rule that only 429 and 5xx are retried. settled() now waits for jobs queued while draining. Verified with pnpm build, test, typecheck, lint and format:check, and a grep showing no hand-rolled chains remain.
<!-- SECTION:FINAL_SUMMARY:END -->
