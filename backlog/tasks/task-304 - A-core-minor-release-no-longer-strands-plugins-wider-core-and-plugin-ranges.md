---
id: TASK-304
title: 'A core minor release no longer strands plugins: wider core and plugin ranges'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 01:53'
updated_date: '2026-10-09 02:10'
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
- [x] #1 A packed plugin declares @geekity/cms as >=<core version it was built against> <1.0.0 in both its package.json peerDependencies and dist/bundle/plugin.json (pnpm rewrites workspace: ranges at pack time, so the chosen spelling must survive pnpm pack; prove it on a real tarball)
- [x] #2 Plugin-to-plugin requirements use the same form (>=x.y.z <1.0.0) in geekity.requires, the peer dependency and plugin.json, and build-plugin-bundle.js still refuses a mismatch between them
- [x] #3 A plugin built against core 0.26.0 installs and is available on a later 0.x core in the registry and plugin add range checks, and is refused on a core older than the one it was built against (tests)
- [x] #4 The docs say when to raise HOST_API_VERSION (a change that breaks plugins written for the current host API) and that the core minor no longer gates plugins; the README section on core releases and the plugins core range is rewritten
- [x] #5 Every plugin package, plugin-wordpress included, gets a releasable change so the next grouped release re-releases all four under the new rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root .pnpmfile.mjs: a beforePacking hook (pnpm 12 runs it after its own workspace: rewrite) that republishes every workspace: peer through one exported publishedPeerDependencies(dir); a 0.x workspace:^ peer becomes >=<workspace version> <1.0.0, so core's lower bound tracks the core version release-please writes. Commit the lockfile's pnpmfileChecksum; Dockerfile copies the pnpmfile before its frozen install.
2. Plugin-to-plugin peers spell the range explicitly (workspace:>=0.2.0 <1.0.0), which pnpm strips to the literal; geekity.requires and plugin.requires carry the same literal.
3. build-plugin-bundle.js imports publishedPeerDependencies, writes plugin.json from it, and refuses a required plugin whose published peer range differs from geekity.requires.
4. Tests: requirementNotes (plugin add) with core 0.27.0 accepted and 0.25.0 refused for a 0.26.0-built range; registry with a range below and above the running core; CLI plugin add on a wide range.
5. README core-range section rewritten, writing-a-plugin example and peer-range paragraph updated, plugin.ts says when to raise HOST_API_VERSION.
6. Prove on real pnpm pack tarballs and plugin.json for all four plugins; run build/test/typecheck/lint/format:check and pack-install-smoke.sh.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mechanism: pnpm 12.4.2 has no workspace: spelling that yields >=<version> <1.0.0 from the workspace version (workspace:>=0.26.0 <1.0.0 survives pack, but as a hand-kept literal). pnpm 12 runs a beforePacking hook from the root .pnpmfile.mjs after its own workspace: rewrite (tested: the hook saw ^0.26.0). The hook recomputes every peer from the source package.json with one exported function, publishedPeerDependencies; a 0.x workspace:^ peer publishes as >=<workspace version> <1.0.0. build-plugin-bundle.js imports the same function for plugin.json. Proof: with packages/cms/package.json set to 0.27.0, plugin-llm's plugin.json and packed package.json both said >=0.27.0 <1.0.0 (reverted after).
Plugin-to-plugin: written out in full, workspace:>=0.2.0 <1.0.0 in the peer, >=0.2.0 <1.0.0 in geekity.requires and plugin.requires. The build now refuses a peer that publishes a different range (proved: peer workspace:>=0.1.0 <1.0.0 failed the post-summary build).
pnpm records pnpmfileChecksum in pnpm-lock.yaml, so the Dockerfile copies .pnpmfile.mjs beside the lockfile; docker:smoke passed.
pnpm release now also refuses a plugin tarball whose plugin.json peer ranges differ from its packed package.json (tarballProblems), which catches a pnpm that stops running the hook.
Host API: the registry and plugin add refused only a newer hostApi, so after this change a plugin targeting an older host API would have run on a core that broke it. Both now refuse any hostApi other than HOST_API_VERSION, so raising the number is the gate the docs describe. No effect today: every plugin and core are at 1.
Validation: pnpm build, test (cms 4971, llm 48, post-summary 17, tag-suggest 30, wordpress 36, demo 32, all pass), typecheck, lint, format:check, scripts/pack-install-smoke.sh and pnpm docker:smoke all pass. Packed tarballs: all four publish @geekity/cms >=0.26.0 <1.0.0, post-summary and tag-suggest @geekity/plugin-llm >=0.2.0 <1.0.0, identical to plugin.json.

AC#5: each plugin folder has its own fix commit on the branch: 18511bd plugin-wordpress, 8121838 plugin-llm, 3f968ef plugin-post-summary, db2f04e plugin-tag-suggest.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A plugin now accepts every core from the one it was built against up to 1.0, and a plugin it requires the same way. A root .pnpmfile.mjs beforePacking hook publishes a 0.x workspace:^ peer as >=<workspace version> <1.0.0, so the lower bound follows the core version release-please writes; build-plugin-bundle.js writes the same ranges into plugin.json from the same function and refuses a requires/peer mismatch; pnpm release refuses a tarball whose plugin.json and package.json peers differ. Plugin-to-plugin ranges are written out (>=0.2.0 <1.0.0). The registry and plugin add refuse any hostApi but the core's, so HOST_API_VERSION is the real gate; README and plugin.ts say when to raise it. Each plugin README states the ranges. Verified on real pnpm pack tarballs of all four plugins, a bumped-core pack (>=0.27.0), tests for later and older cores in registry, requirementNotes and plugin add, and the full gate plus pack-install and docker smokes. AC#5 holds once each plugin folder's change lands as its own fix(plugin-<name>) commit.
<!-- SECTION:FINAL_SUMMARY:END -->
