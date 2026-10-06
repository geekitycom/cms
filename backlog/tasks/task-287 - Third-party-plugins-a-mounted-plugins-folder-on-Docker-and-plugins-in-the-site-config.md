---
id: TASK-287
title: >-
  geekity plugin add: install plugin packages into a mounted plugins folder on
  Docker
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 13:17'
labels:
  - plugins
  - deploy
milestone: m-30
dependencies:
  - TASK-281
  - TASK-288
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - Dockerfile
  - deploy/compose.yaml
  - packages/cms/src/cli.ts
  - 'https://docs.npmjs.com/cli/v10/configuring-npm/package-json'
priority: medium
type: feature
ordinal: 243800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). The Docker image contains core alone, so a Docker site needs a way to install plugin packages without npm or a package.json in the container. `GEEKITY_PLUGINS_DIR` (/site/plugins in the image, a writable mount) holds one folder per plugin. `geekity plugin add <package>[@version]` fetches the tarball from the npm registry, checks its integrity hash, and unpacks the package bundle and manifest into plugins/<name>/; `geekity plugin remove <name>` deletes it; Reload on the Plugins screen (TASK-288) loads the change. A hand-copied folder with a bundled index.js works the same way. This task also adds the shared build every plugin package uses to emit its self-contained bundle (dependencies inlined), proven on a private fixture plugin package in the workspace.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `docker compose exec cms geekity plugin add <package>` installs a plugin that then appears on the Plugins screen after Reload, with no container restart; proven by building the image and installing the fixture package from a local registry or packed tarball while it runs
- [ ] #2 plugin add refuses a tarball whose integrity hash does not match, a package with no bundle, and a bundle that targets a newer host API version, each with a plain message, and leaves the folder as it was
- [ ] #3 plugin add is idempotent: running it twice leaves one folder, and adding a newer version replaces the old one atomically so a reload never sees a half-written folder
- [ ] #4 A folder whose module fails to import or exports no plugin is unavailable on the Plugins screen with the reason; the site still boots
- [ ] #5 The shared bundle build turns a plugin package into one index.js with its dependencies inlined and fails on a native module
- [ ] #6 The Dockerfile creates /site/plugins and sets GEEKITY_PLUGINS_DIR; deploy/compose.yaml has a writable plugins volume beside themes
- [ ] #7 The README has a plugin section for operators (plugin add, remove, Reload) and for authors (the package shape, requires and services, settings and secrets, the host API version and peer range, the bundle, and a warning that a plugin runs with the site's access to data/)
- [ ] #8 A folder install whose manifest peer ranges are not met by core or by an installed plugin package is unavailable on the Plugins screen, naming the package and the range it needs
- [ ] #9 plugin add reads the manifest requires and peer ranges and installs any required plugin package that is missing (post-summary brings llm), choosing the newest version in range, and says what it added
<!-- AC:END -->
