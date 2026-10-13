---
id: TASK-371
title: Tests that wait on real time wait on events instead
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 16:29'
updated_date: '2026-10-12 17:44'
labels: []
milestone: m-37
dependencies: []
priority: medium
type: chore
ordinal: 330800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fourteen test files in packages/cms/src sleep or poll against a wall-clock deadline (for example cli-reload.test.ts, migrated-site.test.ts waiting up to 20 s for the watcher to index a file, and index.test.ts). Under the parallel full run these are the tests that time out: a cli-serve test once timed out under concurrent load and passed alone. Make each one wait for the event it is really waiting for (the watcher or sync announcing a change, the worker reporting ready, a server listening) so the test is as fast as the event and does not fail because the machine is busy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No test file under packages/cms/src waits with a fixed sleep or polls against a Date.now() deadline, except where it measures a duration it asserts on; a check lists any remaining case with its reason
- [x] #2 Each converted test fails, rather than hanging, if the event never comes (a bounded timeout on the event wait is fine)
- [x] #3 The full pnpm test run passes three times in a row, and the wall time of the converted files is reported before and after
- [x] #4 Any seam added to production code for this (an event, a ready signal) is covered by a test of its own
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-measure with a scratch survey script (setTimeout/sleep/poll/Date.now in *.test.ts) and time each candidate file alone (before).
2. Shared helper src/__testing__/wait.ts: nextEvent(what, listen, timeoutMs) resolves on the event, rejects naming the event that never came; test it (resolves, times out with the name, fails early, unsubscribes).
3. Production seam, test first: Cms.onSettled(listener) passing through ContentSync.onSettled, so a test can wait for a watched run and its listeners to finish (index.test covers it). Document it in configuration.md.
4. Convert, each waiting on its real event: index.test (updated event), migrated-site + moved-identity (cms.onSettled), content/sync.test (sync change events, logger warn, sentinel-file barrier for no-op asserts), delivery.test (a delivery arriving at the fake inbox; resend ids from a moved clock), cli-reload (stdout lines, load answers), drain (handler entered), federation/queue (handler entered), admin/routes (moved clock for session expiry), locations (mtime set back instead of sleep), mail-service + util/queue (event-loop turn, not a timer), page-shell YEAR from NOW, drain post date from a pinned clock, cache/rebuild fixed stamps.
5. Check src/test-waits.test.ts: scans *.test.ts for setTimeout/setInterval, node:timers/promises, sleep(, and Date.now() deadlines or comparisons; allowlist {file,line,because}; fails on stale allowances. Prove it fails on a plant, then revert.
6. Time converted files after; pnpm build/test x3/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-measured with a scratch survey: 14 files with timers/polls confirmed; after review, the real waits were in cli-reload, migrated-site, index, drain, content/sync, content/locations, federation/delivery, federation/queue, admin/routes, notifications/mail-service, util/queue, web/moved-identity (schedule.test hits were fake timers, not waits).

Helper: src/__testing__/wait.ts nextEvent(what, listen, timeoutMs=15s) resolves on the event, fails with '<what> never came within N ms', or at once via fail(); always unsubscribes. Own test: __testing__/wait.test.ts.

Seam: Cms.onSettled(listener) passes through ContentSync.onSettled (runs after a scan and after a run of watched changes once every cms.events listener has finished). Tests first in index.test (red: 'instance.onSettled is not a function'): after a scan, after a watched run of two edits, unsubscribe. Documented in docs/configuration.md.

Conversions: index.test waits for the 'updated' event; migrated-site and moved-identity wait for cms.onSettled with the expected rows (subscribed before the write); content/sync.test re-reads on each sync 'change', waits for the logger warning, and uses a sentinel file as a barrier for the no-op/burst asserts; delivery.test waits for a delivery arriving at the fake inbox and moves a pinned clock between resends (proved: without the move the ids are equal); cli-reload waits on stdout lines (port, Reloaded, Reload failed, second port; fails early if the server exits) and on N more answers under load; drain waits for the slow handler to be entered; federation/queue waits for the handler to be entered then one loop turn; admin/routes moves the clock past the session lifetime (proved: fails without the move); locations sets the mtime back instead of sleeping; mail-service and util/queue fakes take an event-loop turn instead of a 5 ms timer; page-shell YEAR from NOW (footer reads the injected clock); drain pins now and dates its post 2027; cache/rebuild use fixed stamps.

Check: src/test-waits.test.ts flags setTimeout(, node:timers/promises, sleep(, Date.now() deadlines and measured durations in test files, with 16 allowances and reasons, and fails on a stale allowance. Plant (a 20 ms setTimeout sleep in util/queue.test and a Date.now() deadline poll in content/locations.test) failed naming util/queue.test.ts:100 and content/locations.test.ts:110/111; reverted, passes. A converted wait with its event removed (index.test edit that changes nothing) failed in 16 s with 'the watcher to report the edit to pages/about.md never came within 15000 ms' rather than hanging. Drain negative window kept at 50 ms: a planted non-waiting drain passed with only a loop turn, failed with the window.

Wall time per file alone, before -> after: cli-reload 62.2 -> 58.1 s; migrated-site 2.0 -> 1.9; index 2.2 -> 2.5 (+3 onSettled tests); drain 1.3 -> 1.3; content/sync 3.9-4.3 -> 3.4; locations 0.1 -> 0.1; delivery 7.2 -> 7.1; federation/queue 0.4 -> 0.4; admin/routes 2.4 -> 2.1; mail-service 0.2 -> 0.2; util/queue 0.1 -> 0.1; moved-identity 1.8 -> 1.4; page-shell 3.8 -> 3.9; cache 0.1 -> 0.1; rebuild 1.1 -> 1.1.

Full pnpm test three times in a row, final code: run 1 exit 0 in 215 s; run 2 exit 0 in 866 s (load average 17-20 from other work on the machine, all of it slow, still green); run 3 exit 0 in 167 s. Each run: cms 5776/5776, demo 32, plugin-llm 48, tag-suggest 31, post-summary 22, wordpress 106, no failures. pnpm typecheck, lint and format:check pass.

AC #1 left unchecked: no test sleeps or polls a Date.now() deadline to wait for something that happens, and the check lists every remaining timer with its reason. But 7 of its 16 allowances are not duration measurements: the nextEvent bound, a child test program's source in offline.test, four 'nothing happens' windows (index.test and sync.test with no watcher running, drain's stopped watcher, drain still waiting for a write, the cli-reload supervisor leaving a folder alone), and two timers that are the scenario (cli-reload slow copy, moved-identity two writes in one debounce). The AC as worded allows only durations; whether these count is the user's call.

Orchestrator decision on AC #1: the criterion allows remaining cases that the check lists with a reason. The seven non-duration allowances (the wait bound, code inside a string, four 'nothing happens' windows that can only be proven by waiting, two timers that are the scenario under test) are listed in src/test-waits.test.ts with reasons and accepted; none waits for an event that does come.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-10-12 17:34
---
AC #1 needs a decision: 7 allowances in src/test-waits.test.ts are absence windows or scenario timers, not durations (see notes). Accept them as listed, or ask for a seam (e.g. a supervisor 'skipped' log line) per case.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tests that slept or polled against a wall-clock deadline now wait on the event they need through src/__testing__/wait.ts nextEvent (bounded, fails naming the event that never came). Watcher tests wait on the new cms.onSettled seam, which has its own tests and docs. Tests that needed time to pass move a pinned clock. src/test-waits.test.ts rejects new sleeps and deadline polling in tests except 16 listed, reasoned allowances (7 duration measurements, the wait bound, a child program's source, four absence windows and two scenario timers, accepted by the orchestrator). The full pnpm test run passed three times in a row; per-file wall time is in the notes.
<!-- SECTION:FINAL_SUMMARY:END -->
