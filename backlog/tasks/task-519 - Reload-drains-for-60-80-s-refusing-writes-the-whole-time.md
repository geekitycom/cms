---
id: TASK-519
title: Reload drains for 60-80 s, refusing writes the whole time
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-26T02:09:00Z'
updated_date: '2026-10-26T02:56:00Z'
labels:
  - supervisor
  - plugins
dependencies: []
priority: high
type: bug
ordinal: 421800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On andrewshell.org (0.44.0, plugin-umami 0.6.0, plugin-wordpress 0.11.0) on 2026-10-26, Update all and Reload each took 67 s and 79 s. The supervisor logged 'Reloading: the running server is draining.' and the new worker logged 'is serving' 66 s and 79 s later. A cold boot of the same site takes about 4 s (container start 02:04:31, serving 02:04:35). No 'Draining: waiting for N writes in flight' line was logged, so the write gate's refuse() returned at once, and the time goes to endServices(lifecycle, 'drain') in packages/cms/src/cms/create.ts. For the whole drain, every POST got 503: ActivityPub inbox deliveries to /inbox/ and /wp-json/activitypub/1.0/inbox, and the user's second Update all click. The admin request that asked for the reload hung until it finished, so the owner saw a page spinning for over a minute and thought the reload had failed. Find which service's stop/settled holds the drain, fix the root cause so a drain finishes in seconds, and cap how long any one service may hold it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test reproduces a drain held by the slow service and fails before the fix
- [x] #2 A reload of a site with in-flight background work finishes draining within a few seconds
- [x] #3 If a service still has not settled after a bounded wait, the drain logs which service and carries on
- [x] #4 The reload is checked end to end with geekity serve and the time from draining to serving is reported
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce locally: scratch site under geekity serve with both plugins, followers on a slow local peer, an inbox log of actors whose server hangs; time each service's stop/settled during a reload with temporary instrumentation.
2. Root cause: the actor profile, avatar and reply backfill sweeps run to the end of their list after stop(), and settled() waits for the whole sweep; the profile loader has no deadline. An in-flight Fedify outbox delivery holds the federation queue until its request ends.
3. Failing tests first: a stopped sweep settles promptly and fetches nothing more (profiles, avatars, backfill); a drain carries on past a service that does not settle, naming it.
4. Fix: each sweep owns an abort signal that stop() aborts; the loop stops between items and the fetch in flight is aborted; an aborted fetch is not recorded as a failure. Services carry names; drain gives each service a bounded wait and logs the one that did not settle (the read-only switch still cuts off its writes, as it does for a request write past the write wait).
5. Remove instrumentation; verify end to end with geekity serve before/after; run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced locally (scratch site under geekity serve, both plugins from dist/bundle, followers and an inbox log pointing at a local peer that hangs or answers slowly, federation.allowPrivateAddress on). Temporary timing in endServices showed two services holding the drain:
- the actor profile sweep: start() sweeps every inbox actor at boot, one at a time; stop() only cleared the timer, so a drain waited for the whole list, and the profile loader passed no signal to lookupObject. With 15 actors on a server whose WebFinger hangs, the drain was still waiting after 10 minutes (one actor per ~5 min, the undici headers timeout).
- the federation queue: an outbox delivery in flight (a boot retry to a hanging inbox) held settled() for 294 s. Fedify's delivery fetch takes no signal, so it cannot be aborted from here.
Avatars and reply backfill have the same sweep-runs-on-after-stop shape. On production both reloads came right after a boot (20 s and 0 s), while the boot sweeps were running, which fits the 66 s and 79 s (inferred; production was not touched).
Fix: stop() on the three sweeps aborts a per-run AbortController; the loop stops between items, the fetch in flight gets the signal (lookupObject, document loader, fetchPublic), and a fetch cut off is neither logged nor recorded as a failure. Each lifecycle service has a name; a drain waits at most DRAIN_PATIENCE_MS (10 s) for any one service's stop or settled, then logs 'Draining: <name> had not finished after 10 s, so the reload goes on without it.' and carries on to the read-only switch. close() still waits in full.

End to end, geekity serve on the scratch site, reload asked over the control socket, time from 'Reloading: the running server is draining.' to the new 'is serving':
- before, boot sweep and a retried delivery to hanging peers in flight: federation queue settled after 294 s, then the actor profile sweep held the drain past 10 minutes (stopped by hand).
- after, profile sweep in flight (mid-WebFinger to a hanging server): 0.44 s, no warning.
- after, outbox delivery in flight to a hanging inbox: 10.5 s, with 'Draining: the federation queue had not finished after 10 s, so the reload goes on without it.' Fedify's delivery fetch takes no signal, so this one is capped rather than aborted.
Full suite: pnpm build, test (cms 7679 pass), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reload drained for minutes when background work was in flight, because the actor profile, avatar and reply backfill sweeps ran to the end of their lists after stop() and the drain waited for them; the profile loader also had no deadline. Each sweep now owns an abort signal that stop() aborts: the loop stops between items, the fetch in flight is aborted (lookupObject, the document loader, fetchPublic), and a fetch cut off is not recorded as a failure, so the next worker's sweep asks again. Every lifecycle service now has a name, and a drain waits at most 10 s for any one service to stop or settle, then logs which service it left behind and carries on to the read-only switch, which cuts off that service's database and file-helper writes as it already does for a request write past the write gate's wait. close() still waits in full. This cap is what bounds an outbox delivery in flight, which Fedify gives no way to abort.

Verified with tests that fail before the fix (profiles, avatars, backfill, lifecycle) and end to end under geekity serve: drain to serving went from over 10 minutes to 0.44 s with a profile sweep in flight, and from 294 s to 10.5 s with a delivery to a hanging inbox in flight.

Risks: a service the drain gives up on keeps running in the old worker; its outcome writes to the database are refused (a delivery row can stay queued), and raw fs writes outside the file helpers are not covered by the read-only switch. The old worker can also linger after retiring until such work ends, since close() is not capped. Production cause is inferred: both slow reloads came within 20 s of a boot, while the boot sweeps were running.
<!-- SECTION:FINAL_SUMMARY:END -->
