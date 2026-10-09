---
id: TASK-304
title: 'A core minor release no longer strands plugins: wider core and plugin ranges'
status: To Do
assignee: []
created_date: '2026-10-09 01:53'
labels: []
dependencies: []
references:
  - scripts/build-plugin-bundle.js
  - packages/cms/src/plugins/registry.ts
  - packages/cms/src/plugins/install.ts
  - README.md
priority: high
type: enhancement
ordinal: 264800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each plugin bundle pins @geekity/cms with the caret range of the core it was built against (workspace:^ becomes ^0.25.0), which before 1.0 accepts one core minor only. When core 0.26.0 shipped, plugin-wordpress 0.1.0 (not changed in that release, so not re-released) showed on shll.me as "It needs @geekity/cms ^0.25.0, and this core is 0.26.0." Plugin-to-plugin ranges in geekity.requires (post-summary and tag-suggest on plugin-llm ^0.2.0) have the same problem. Andrew approved the fix on 2026-10-09: a plugin accepts any core from the version it was built against up to 1.0, and the host API version (hostApi, already checked) is what marks a real break.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A packed plugin declares @geekity/cms as >=<core version it was built against> <1.0.0 in both its package.json peerDependencies and dist/bundle/plugin.json (pnpm rewrites workspace: ranges at pack time, so the chosen spelling must survive pnpm pack; prove it on a real tarball)
- [ ] #2 Plugin-to-plugin requirements use the same form (>=x.y.z <1.0.0) in geekity.requires, the peer dependency and plugin.json, and build-plugin-bundle.js still refuses a mismatch between them
- [ ] #3 A plugin built against core 0.26.0 installs and is available on a later 0.x core in the registry and plugin add range checks, and is refused on a core older than the one it was built against (tests)
- [ ] #4 The docs say when to raise HOST_API_VERSION (a change that breaks plugins written for the current host API) and that the core minor no longer gates plugins; the README section on core releases and the plugins core range is rewritten
- [ ] #5 Every plugin package, plugin-wordpress included, gets a releasable change so the next grouped release re-releases all four under the new rule
<!-- AC:END -->
