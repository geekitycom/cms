---
id: TASK-410
title: The plugin federation outbox and followers return promises
status: To Do
assignee: []
created_date: '2026-10-14 16:26'
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
- [ ] #1 outbox and followers on PluginFederationContext return Promise<PluginCollection<…> | undefined>, and web/plugin-federation.ts implements them that way
- [ ] #2 @geekity/plugin-wordpress src/federation.ts awaits them in its Fedify counter and cursor callbacks, and its federation tests pass
- [ ] #3 docs/plugins.md says the two members return promises, and the change lands as a breaking change for plugins
- [ ] #4 pnpm typecheck, pnpm lint and pnpm test pass
<!-- AC:END -->
