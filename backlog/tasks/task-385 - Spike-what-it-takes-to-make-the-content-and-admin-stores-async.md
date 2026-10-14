---
id: TASK-385
title: 'Spike: what it takes to make the content and admin stores async'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-13 12:10'
updated_date: '2026-10-14 14:36'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
  - >-
    backlog/decisions/decision-56 -
    How-far-an-async-content-and-admin-store-would-reach.md
priority: low
type: spike
ordinal: 344800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 keeps a future Aurora (Postgres) build possible. ContentStore (content/store.ts) and AdminStore (store/admin-store.ts) are synchronous because node:sqlite is, and every Postgres driver is async, so such a build would need both interfaces to return promises. That change reaches every caller, up through routes and template rendering. This spike measures how far before anyone commits to it. Search is SQLite FTS5 behind SearchReader, and a rebuild deletes the database file (cache.ts rebuildingIfOutdated); both would differ on Postgres. Nothing is built for Postgres.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The record counts the call sites and files that change if each store method returns a promise, by layer (routes, templates, services, plugins API), with the method of counting so it can be rerun
- [ ] #2 The record says whether the theme template engine and the plugin API can await store calls, and what breaks for published themes and plugins
- [ ] #3 The record says how search and rebuild would work behind the interfaces on Postgres, on paper
- [ ] #4 The record recommends a sequence of verifiable steps, or recommends not doing it until there is a real need, with reasons; follow-up tasks are filed only if it recommends going ahead
- [ ] #5 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read decision-52/53/54, the two store interfaces, cache.ts and the render and plugin paths.
2. Measure the reach with a TypeScript language-service walk (_local/async-stores-spike/reach.ts): direct call sites, functions that turn async transitively, awaits added, files, by area and layer, and where the walk stops.
3. Cross-check with a throwaway prototype (_local/async-stores-spike/flip.ts): flip every store method to return a promise, count tsc and eslint findings for content, admin and both, then revert.
4. Check whether Nunjucks can render a promise-returning context function, and time await overhead on a node:sqlite lookup.
5. Work out search (FTS5 behind SearchReader) and rebuild (cache.ts rebuildingIfOutdated, geekity rebuild) on Postgres on paper.
6. Compare options (full async, sync fast path, prefetch before render, wait), recommend one, and write findings, a step sequence and proposed tasks into decision-56 (status proposed).
7. Leave TASK-385 In Progress until the user accepts decision-56 (AC #5).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured at 9053eef1 on 2026-10-14; findings are in decision-56 (status proposed).

Reach (reach.ts, lower bound): 101 store members (ContentStore 37, AdminStore 64). 260 direct call sites in src (74 already in async functions, 186 in sync ones) and 1,084 in tests. 326 src functions and 100 test functions turn async; 278 src and 622 test calls then need only an await. 99 of 403 src files and 114 of 356 test files change, plus 23 SQLite implementation files (4,731 lines). By layer, functions that turn async: routes 117, services 115, template context 91, plugin API 3.

Prototype flip (flip.ts, reverted): 569 tsc errors in 90 files for ContentStore alone, 615 in 73 for AdminStore, 1,181 in 141 for both (446 src, 735 tests). eslint adds 349 no-floating-promises and 16 no-misused-promises that tsc does not catch.

Templates: Nunjucks renders a promise-returning context function as an empty loop or [object Promise] with no error. Only newestPosts(count) is store-backed and called from templates; everything else is read before environment.render and can be awaited there. postLabel reaches the stores through the CitedPageReader. Plugin API: only PluginFederationContext.outbox and followers break (plugin-wordpress, 8 lines in Fedify callbacks that accept promises). Cms.store, Cms.admin and GeekityEnv also expose the stores to embedders.

Await overhead on a node:sqlite point lookup: 0.56 vs 0.62 us a call, so a sync fast path wins nothing.

Recommendation: wait until a Postgres build is real; prefetch-before-render is the shape for the render path when it is. Two optional proposed tasks in decision-56: async plugin federation outbox/followers in the pending major, and keeping reach.ts under scripts/. No tasks filed. Scripts are in the git-ignored _local/async-stores-spike/.
<!-- SECTION:NOTES:END -->
