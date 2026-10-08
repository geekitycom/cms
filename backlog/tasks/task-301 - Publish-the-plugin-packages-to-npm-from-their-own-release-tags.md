---
id: TASK-301
title: Publish the plugin packages to npm from their own release tags
status: To Do
assignee: []
created_date: '2026-10-08 17:17'
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
release-please now cuts independent releases for @geekity/plugin-wordpress, @geekity/plugin-llm, @geekity/plugin-post-summary and @geekity/plugin-tag-suggest (tags like plugin-llm-v0.1.0), but scripts/npm-publish.sh and scripts/release.sh publish @geekity/cms only. Until a plugin is on npm, `geekity plugin add` (TASK-287) has nothing to install, and the post-summary and tag-suggest requirement on @geekity/plugin-llm ^0.1.0 cannot be satisfied. A plugin bundle also pins core with the caret range of the core version it was built against (plugin.json, from workspace:^), so a plugin released before a core minor bump is unavailable on the new core: the release order and range need a rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A maintainer can publish one plugin package from the commit its release tag names, with the same preflight checks and quality gates core has (tag on HEAD, clean tree, version matches, bundle and plugin.json present)
- [ ] #2 The published tarball contains dist/bundle/index.js and dist/bundle/plugin.json, and `geekity plugin add <pkg>` installs it from the public registry in a scratch Docker site
- [ ] #3 The core range written into plugin.json is decided and documented: which core versions a released plugin accepts, and what happens to installed plugins across a core 0.x minor release
- [ ] #4 README release instructions cover publishing a plugin and the order relative to a core release
<!-- AC:END -->
