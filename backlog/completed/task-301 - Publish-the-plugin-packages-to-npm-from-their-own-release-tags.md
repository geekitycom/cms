---
id: TASK-301
title: One release pull request and one pnpm release for every package
status: Done
assignee: []
created_date: '2026-10-08 17:17'
updated_date: '2026-10-09 01:47'
labels: []
dependencies: []
references:
  - scripts/npm-publish.sh
  - scripts/release.sh
  - scripts/build-plugin-bundle.js
  - release-please-config.json
documentation:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
priority: high
type: chore
ordinal: 261800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Andrew wants one release flow for the whole monorepo: release-please opens a single release pull request that bumps every package with releasable changes; after merging it, `git pull --prune --tags` on main and `pnpm release` builds and tests once, publishes every package whose version is not on npm yet (core and each plugin), and pushes the image when core has a version without one. Today release-please opens one PR per package (separate-pull-requests, a workaround for release-please issue 2214 from when core was the only package), the PRs conflict on the manifest, and scripts/release.sh publishes only @geekity/cms and requires HEAD to carry core's tag, which breaks once any other release PR merges after it. Plugin packages have no publish step at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 release-please-config.json opens one grouped release pull request for all packages (separate-pull-requests off) with a title the pr-title and commitlint checks accept; each package keeps its own version, changelog and tag (core v<version>, plugins <component>-v<version>)
- [x] #2 `pnpm release` run on main, level with origin and clean, finds every package whose package.json version is not on npm, refuses unless that version's release tag exists and is an ancestor of HEAD, runs the build and quality gates once, then publishes those packages in dependency order (core, plugin-llm, then the plugins that require it) with --access public
- [x] #3 A plugin is published only when its packed tarball contains dist/bundle/index.js and dist/bundle/plugin.json whose name and version match the package
- [x] #4 The image is built and pushed only when core's version has no image yet; a release with only plugin bumps pushes no image
- [x] #5 `pnpm release:dry-run` lists each package it would publish and whether it would push the image, and why, without checking credentials or running gates; with nothing to release, `pnpm release` says so and exits 0
- [x] #6 Every plugin package.json has publishConfig.access public
- [x] #7 The core range written into plugin.json is documented: which core versions a released plugin accepts and what happens to installed plugins across a core 0.x minor release
- [x] #8 The README release section describes the one-PR flow, the order, and what to check after the first grouped release merges (every package tagged); the per-package scripts that remain are documented or removed
- [x] #9 Tests cover the selection of packages to publish, the order, the tag check and the image decision without touching npm or a registry
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. release-please-config.json: drop separate-pull-requests and every pull-request-title-pattern; add group-pull-request-title-pattern 'chore(release): release ${branch}'; set core package-name to "" so a grouped PR that bumps only core still tags v<version> (proved by running release-please 17.11.2's own strategy + Merge code against the config: without it a core-only grouped PR cuts no tag, release-please issue 2214 again).
2. scripts/release.ts (run by node, type-stripped): reads the packages from release-please-config.json, derives tag names and dependency order (dependencies, peerDependencies, geekity.requires), asks npm which versions are missing and the registry whether core's image exists, checks each pending tag exists, is an ancestor of HEAD and packages/<pkg> is unchanged since it. Pure planRelease/releaseOrder functions; IO at the edges.
3. Real run: preflight (main, clean, level with upstream, npm whoami, docker-build-push.sh --check-only when an image is due), gates once, pack every package and verify each tarball (name/version; plugins carry dist/bundle/index.js and a matching plugin.json), npm publish each tarball --access public in order, then docker-build-push.sh --skip-gates. Rerunning pnpm release resumes a half-done release.
4. Delete npm-publish.sh, its test and npm:publish/npm:dry-run; fold the gate list into docker-build-push.sh and release.ts, delete scripts/lib/quality-gates.sh.
5. publishConfig.access public on every package.
6. Tests (packages/cms/src/release.test.ts): pure plan/order tests plus end-to-end runs in a real git fixture with stub npm/pnpm/docker.
7. README: Releasing section rewritten for the one-PR flow, the post-merge tag check, hand-tagging recovery, core range policy; command table updated.
8. Verify: build/test/typecheck/lint/format, pnpm release:dry-run here, and a scratch-clone simulation of a pending release.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built scripts/release.ts (node, type-stripped) in place of release.sh + npm-publish.sh + lib/quality-gates.sh; docker-build-push.sh stays as the one place the image is built and owns its 4 gates. Plan is read from npm (npm view, E404 = unpublished) and the registry (docker manifest inspect), so a rerun resumes a half-done release. Each version to publish needs its tag to exist, be an ancestor of HEAD, and git diff <tag> HEAD -- <dir> to be empty. Every tarball is packed and checked before the first npm publish <tarball> --access public; order derived from dependencies/peerDependencies/geekity.requires.
release-please: simulated grouped PRs with release-please 17.11.2's own strategy + Merge code (scratch script). Plain grouped mode cuts no tag when only core is bumped (core's release has no component, the grouped branch has none, core's branch component is 'cms' -> mismatch, issue 2214). Setting core package-name to "" makes the branch component empty and the core-only case tags v<version>; multi-package and plugin-only cases tag every bumped package either way. Group title 'chore(release): release main' passes commitlint. AC#1 left unchecked: proven offline against release-please's code, not yet by a real merge on GitHub.
Verification: pnpm build, test (4963 cms + plugin + demo suites), typecheck, lint, format:check all pass. pnpm release:dry-run on this branch: nothing to release, exit 0. Scratch clone with cms 0.26.0, plugin-llm 0.2.0, plugin-post-summary 0.2.0 tagged, npm publish / gates / buildx faked, real pnpm pack: plan cms, plugin-llm, plugin-post-summary + image 0.26.0, packed and checked all three, published in that order, then built the image. Mutation checks (no topo sort, no diff check, no tarball check, no bundle check, never push image) each fail release.test.ts.

2026-10-09: the first grouped release pull request, #148 (chore(release): release main), bumped core 0.26.0 and plugin-llm, plugin-post-summary and plugin-tag-suggest 0.2.0. Its merge commit e08aec7 carries v0.26.0, plugin-llm-v0.2.0, plugin-post-summary-v0.2.0 and plugin-tag-suggest-v0.2.0, with a GitHub release for each, so release-please issue 2214 did not recur. pnpm release then published all four to npm and pushed ghcr.io/geekitycom/cms:0.26.0. Core showed on npm a couple of minutes after the others; npm said the package was being processed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Releasing is one release-please pull request for every package, then git pull --prune --tags and pnpm release, which publishes each package not yet on npm in dependency order and pushes the image when core's version has none. Verified by release.test.ts and by the 0.26.0 release (#148): every bumped package was tagged and published, and the image pushed.
<!-- SECTION:FINAL_SUMMARY:END -->
