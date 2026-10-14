---
id: TASK-410
title: The plugin federation outbox and followers return promises
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:26'
updated_date: '2026-10-14 16:45'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-56 -
    Stores-stay-synchronous-until-a-Postgres-build-is-real.md
  - packages/cms/src/plugin.ts
  - packages/cms/src/web/plugin-federation.ts
  - packages/plugin-wordpress/src/federation.ts
priority: medium
type: enhancement
ordinal: 359800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PluginFederationContext.outbox(username) and .followers(username) (packages/cms/src/plugin.ts) return their collection synchronously because totalItems comes from countByAuthor and countFollowers. decision-56 found they are the only plugin API members an async store would break. Change them to return promises in the major release already pending, so a later Postgres build does not break plugins a second time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 outbox and followers on PluginFederationContext return Promise<PluginCollection<…> | undefined>, and web/plugin-federation.ts implements them that way
- [x] #2 @geekity/plugin-wordpress src/federation.ts awaits them in its Fedify counter and cursor callbacks, and its federation tests pass
- [x] #3 docs/plugins.md says the two members return promises, and the change lands as a breaking change for plugins
- [x] #4 pnpm typecheck, pnpm lint and pnpm test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. HOST_API_VERSION: released cores (v0.31.0) and plugins (plugin-wordpress-v0.4.0 etc.) all carry 1; 2 is unreleased (f046118b, after v0.31.0), so this break rides on 2 and the number stays.
2. Failing test first: web/plugin-federation.test.ts asserts outbox/followers return promises (instanceof Promise for a stranger and a known user) and awaits them.
3. plugin.ts: outbox and followers return Promise<PluginCollection<…> | undefined>; web/plugin-federation.ts makes both async.
4. plugin-wordpress federation.ts awaits them in the dispatcher, counter and cursor callbacks; run its federation tests and fed-smoke if offline.
5. docs/plugins.md: say the two members return promises; check other plugin packages for callers (none found by grep).
6. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PluginFederationContext.outbox/followers now return Promise<PluginCollection<…> | undefined>. web/plugin-federation.ts returns Promise.resolve(...) rather than async methods because the bodies have no await (lint require-await). plugin-wordpress federation.ts awaits them in both dispatchers and makes the six counter/first/last cursor callbacks async (Fedify accepts promises there).
HOST_API_VERSION stays 2: every released core (v0.31.0) and plugin (plugin-wordpress-v0.4.0, plugin-llm/tag-suggest v0.2.2) carries 1; 2 was set in f046118b after v0.31.0 and is unreleased, and install.ts/registry.ts refuse any hostApi !== HOST_API_VERSION, so no released plugin built against 2 exists. This break rides on the 1->2 bump.
Only caller is plugin-wordpress; plugin-llm, plugin-post-summary and plugin-tag-suggest do not use the federation context (git grep).
Test first: plugin-federation.test.ts asserted instanceof Promise and failed ('the outbox is answered as a promise') before the change.
Validation: pnpm build, typecheck, lint, format:check, test all pass (cms 6019, plugin-wordpress 106, plugin-llm 48, post-summary 22, tag-suggest 31, demo 32; 0 fail). pnpm --filter @geekity/plugin-wordpress fed:smoke passed offline (loopback), including the outbox/followers/following collections under the old path.
AC#3: docs/plugins.md updated; the breaking-change part lands with the commit (feat(cms)! with a BREAKING CHANGE footer), so it stays unchecked until committed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PluginFederationContext.outbox and .followers return promises (packages/cms/src/plugin.ts, web/plugin-federation.ts); the WordPress plugin awaits them in its Fedify counter and cursor callbacks; docs/plugins.md says so. Landed as the breaking commit 02eeafcb (feat(cms)! with a BREAKING CHANGE footer). HOST_API_VERSION stays 2 because 2 is unreleased. Checks pass, and the WordPress fed:smoke passed offline.
<!-- SECTION:FINAL_SUMMARY:END -->
