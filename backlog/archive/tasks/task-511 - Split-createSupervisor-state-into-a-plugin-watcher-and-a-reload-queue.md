---
id: TASK-511
title: Split createSupervisor state into a plugin watcher and a reload queue
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 12:53'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 422800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/supervisor/primary.ts:100 createSupervisor is ~262 lines with about 12 let variables (loaded, reloading, failed, waiting, queued, seen, compared, changing, ...) in one closure; look() mixes signature debounce, logging and reload triggering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plugin change detection and reload sequencing are separate units with their own state and intention-revealing names
- [x] #2 Supervisor behaviour is the same: supervisor and cli-reload tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm primary.test.ts and cli-reload.test.ts are green, several runs.
2. Add supervisor/reload-queue.ts: createReloadQueue() owns the two waiter lists (asked for but not taken up; taken up by the reload under way) with ask(), hasAsked(), begin(), answer(outcome), answerAll(outcome). Replaces queued/waiting/settle in createSupervisor.
3. Add supervisor/plugin-watcher.ts: createPluginWatcher() owns polling and the settle debounce (seen, changing, polling) plus the folder memory (loaded, reloading, failed, compared). look() becomes hasSettled(signature) (debounce + the once-only changing line) and considerReload(signature) (compare with loaded/failed, then ask the supervisor to reload). The supervisor tells it reloading(folder), loaded(plugins), failed(); it calls back isServing() and reload(folder). PLUGIN_POLL_MS, PLUGIN_SETTLE_MS and PluginWatch move with it; test imports follow.
4. createSupervisor keeps the worker state machine (state, live, bootErrors, everServed, crashes) and calls the two units at the same points in the same order as before.
5. Rerun supervisor and cli-reload tests several times, then the full verify: pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. supervisor/reload-queue.ts (createReloadQueue: asked / underWay lists; ask, hasAsked, begin, answer, answerAll) replaces queued, waiting and settle. supervisor/plugin-watcher.ts (createPluginWatcher) owns seen, changing, polling, loaded, reloading, failed and compared; look() is now hasSettled(signature) for the debounce and the once-only 'changing' line, then considerReload(signature) for the loaded/failed comparison and the reload request. createSupervisor keeps the worker state machine (state, live, bootErrors, everServed, crashes) and calls the units at the same points in the same order. The not-watched line stays in start() before the fork, as before. PLUGIN_POLL_MS, PLUGIN_SETTLE_MS and PluginWatch moved to plugin-watcher.ts; primary.test.ts and cli-reload.test.ts changed only their import lines. Options are wrapped in arrows because @typescript-eslint/unbound-method rejects passing options.schedule/now/log. createSupervisor 262 -> 207 lines, 12 lets -> 3. No clock-boundary change: Date.now stays in superviseCluster.
Validation: supervisor + cli-reload tests 38/38 three runs before and five after; pnpm build, pnpm test (cms 7481 pass, all packages 0 fail), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split createSupervisor's closure state into two units: createPluginWatcher (plugin-watcher.ts: polling, settle debounce, and what is loaded/reloading/failed) and createReloadQueue (reload-queue.ts: requests asked for and taken up by the reload under way). The supervisor keeps only the worker state machine and calls both at the same points as before. Verified with the supervisor and cli-reload tests (38/38, repeated runs, assertions unchanged, only import paths moved) and the full pnpm build/test/test:11ty/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
