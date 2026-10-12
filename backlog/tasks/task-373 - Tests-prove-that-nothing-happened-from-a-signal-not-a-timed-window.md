---
id: TASK-373
title: 'Tests prove that nothing happened from a signal, not a timed window'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 17:49'
updated_date: '2026-10-12 19:19'
labels: []
milestone: m-37
dependencies:
  - TASK-371
priority: high
type: chore
ordinal: 332800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-371, packages/cms/src/test-waits.test.ts still allows timed windows that make the suite slow: cli-reload.test.ts waits poll + settle + 2 s (about 8 s) to show the supervisor leaves a failed plugins folder alone and runs a 3 s slow hand copy; index.test.ts and content/sync.test.ts wait 500 ms to show no event comes with the watcher off or after close; drain.test.ts waits 400 ms (drained watcher) and 50 ms (drain still waiting for a write); web/moved-identity.test.ts puts a 40 ms gap between two writes inside one debounce. The user wants every such wait replaced, because the suite takes a very long time to run. Give each case a signal to wait on instead: a log line or event when the supervisor skips a folder, a closed/stopped state the watcher reports, a debounce the test can drive directly, or a fake clock where the code already takes one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 test-waits.test.ts allows only duration measurements, the bound inside the shared wait helper, and code inside strings; every absence window and scenario timer is gone from its list
- [x] #2 Each converted test still fails when the behaviour it guards breaks (prove it with a planted regression per case, then revert)
- [x] #3 Any production signal added for this has a test of its own and follows the layer map
- [x] #4 Wall time of each converted test file, run alone, is reported before and after
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure each file alone (before).
2. Watcher absence windows (index.test, content/sync.test, drain.test 400 ms): test helper __testing__/watchers.ts liveWatchers() spies node:fs watch and counts watches whose close() was not called; assert the watcher never started or was closed. Own test.
3. moved-identity 40 ms gap: production seam WatchDebounce (content/sync.ts, replaces debounceMs) exposed as config watchDebounce; test helper __testing__/debounce.ts heldDebounce() releases paths by hand. Seam tests first in content/sync.test.
4. drain 50 ms: production seam cms.drain(waiting?) / WriteGate.refuse(waiting?) reports how many writes it waits for; the worker logs it. Tests first (drain.test, new supervisor/worker.test).
5. cli-reload 8 s windows and 3 s copy: supervisor lines (folder changing, folder left alone after a failed reload, folder not watched); read the folder baseline at start. Tests first in supervisor/primary.test.
6. Plugin tests: wordpress import-dev-mode waits on cms.onSettled; plugin-llm abort fires when the fake provider receives the request.
7. Trim test-waits allowlist to durations, the wait bound and the child-program string; docs; plant a regression per case; measure after; full verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed allowances and their signals:
- index.test 500 ms (watch off; after close) and content/sync.test 500 ms (stopped; watch off), drain.test 400 ms (drained watcher): liveWatchers() from __testing__/watchers.ts (spies node:fs watch via syncBuiltinESMExports, counts watches whose close() was not called). Tests assert 1 while serving, 0 after close/stop/drain, 0 with watch off, 1 again after resume.
- web/moved-identity 40 ms: config watchDebounce (new public type WatchDebounce; content/sync.ts debounceFor/defaultWatchDebounce replace debounceMs). The burst test passes heldDebounce() (__testing__/debounce.ts), holds the three paths, releases the delete and the move, waits for the move's created event plus one loop turn, then releases the new post.
- drain.test 50 ms: cms.drain(waiting?) and WriteGate.refuse(waiting?) report the number of writes in flight when the drain has to wait; the test waits on it (raced against the drain finishing, so a drain that does not wait fails fast) and asserts nothing has stopped. The worker logs 'Draining: waiting for N write(s) in flight to finish.'
- cli-reload windowForTheWatch (twice) and copyingSlowly: supervisor lines. 'The plugins folder is changing; it loads once it has stood still for 5 s.' (once per change run), 'The plugins folder is as it was when its reload failed, so it is left alone until it changes.' (keepOld now clears compared so the next look reports it once), 'The plugins folder is not watched: press Reload on the Plugins screen to load a change.' (SupervisorOptions.watch may be 'off'). The supervisor now reads the folder baseline at start, not at the first poll; found because the first poll came after the test's copy had begun, so the copy was read as the baseline.
- Plugin tests: plugin-wordpress import-dev-mode waits on cms.onSettled (subscribed before the writes; bounded by the test's 30 s timeout, nothing new exported to plugins); plugin-llm complete.test aborts when the fake provider receives the request instead of after 50 ms. No other sleeps or deadline polls in plugin or demo tests (fake servers' delayMs simulate slow servers; followers.test measures a duration).

New seam tests: content/sync.test 're-reads a changed path only once its debounce lets it', 'settles once, after the last path waiting out its debounce has been read'; drain.test 'says nothing about waiting when no write is in flight' plus the converted test; supervisor/worker.test (3); supervisor/primary.test (changing line, start baseline, unreadable folder, left-alone line, not-watched line); config.test default; __testing__/watchers.test.

Planted regressions (each failed, then reverted): sync stop() without watcher.close() -> index.test, sync.test, drain.test fail ('closing stopped the watch', 'the watch is closed', 'the watcher stopped'); start() ignoring watch:false -> index.test and sync.test watch-off tests fail; settle ignoring pending debounces -> sync.test settles-once and moved-identity burst fail; debounce option ignored -> sync.test seam tests fail (15 s, naming the held path); services not passing watchDebounce -> moved-identity fails; refuse() not waiting -> drain test fails in 35 ms ('finished without waiting'); refuse() reporting but not waiting -> 'nothing has stopped' fails; supervisor retrying the failed folder -> cli-reload 'not tried again' fails; supervisor ignoring GEEKITY_PLUGIN_WATCH=off -> cli-reload watch-off fails (line never came); supervisor without the settle wait -> hand-copy 'not before the folder had stood still' fails; dev mode not recording a hold -> import-dev-mode fails; plugin-llm ignoring the caller's signal -> abort test fails.

Wall time alone, before -> after (load 1-4): index 2.70 -> 2.11 s; content/sync 3.70 -> 2.56; drain 1.41 -> 0.96; web/moved-identity 1.46 -> 1.33; cli-reload 57.75 -> 41.05 (hand copy 10.1 -> 8.1, failed folder 21.1 -> 14.1, watch off 9.1 -> 1.0; the rest is the real 5 s settle time); plugin-wordpress import-dev-mode 1.41 -> 1.10; plugin-llm complete 1.53 -> 1.53. supervisor/primary 0.35, supervisor/worker 0.32.

macOS watcher probe: measured ContentSync.start() at 6-14 ms or 188-267 ms, alternating: when the first probe is made before FSEvents listens, the next one comes 250 ms later. Not changed: a shorter interval only in tests would need the probe to accept any earlier probe's event (a production behaviour change) or risk false 'hears nothing' waits under load; the saving is about 250 ms per watcher start on half the starts.

Verification: pnpm build, typecheck, lint, format:check pass. Full pnpm test (repo root) exit 0 in 273 s at load 9-13 (cms 5794, demo 32, llm 48, post-summary 22, tag-suggest 31, wordpress 106). packages/cms pnpm test alone exit 0 in 346 s at load 11-17 (other work on the machine).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every absence window and scenario timer in the tests now waits on a signal. Watcher absence is asserted through liveWatchers (open watches counted). The watched burst in moved-identity is driven by a held debounce through the new watchDebounce config option (public type WatchDebounce). The drain reports the writes it waits for through cms.drain(waiting), and the worker logs it. The supervisor prints when the plugins folder starts changing, when it leaves a folder whose reload failed, and when the folder is not watched. It now reads the folder at start. cli-reload waits on those lines. The plugin-wordpress dev-mode import waits on cms.onSettled, and the plugin-llm abort fires on the request. test-waits.test.ts allows only the 7 duration measurements, the nextEvent bound and the child-program string. Each converted case failed under a planted regression, and each new seam has its own tests. cli-reload went from 57.8 s to 41.1 s. Verified with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
