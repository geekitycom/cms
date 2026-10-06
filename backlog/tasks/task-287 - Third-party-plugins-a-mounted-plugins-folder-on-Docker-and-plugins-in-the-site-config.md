---
id: TASK-287
title: >-
  Third-party plugins: a mounted plugins folder on Docker and plugins in the
  site config
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 12:09'
labels:
  - plugins
  - deploy
milestone: m-30
dependencies:
  - TASK-284
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - Dockerfile
  - deploy/compose.yaml
  - packages/cms/src/cli.ts
  - packages/cms/src/config.ts
priority: medium
type: feature
ordinal: 243800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Sites on the Docker image run no code of their own today. `GEEKITY_PLUGINS_DIR` (default /site/plugins in the image) holds one folder per plugin with a bundled index.js whose default export is the plugin; the host is passed in, so the module needs no runtime import of @geekity/cms, which a mounted folder could not resolve. Types for authors come from a new `@geekity/cms/plugin` subpath export. A site that runs its own server.ts passes plugin objects in `plugins` on its config. The host API carries a version; a plugin targeting a newer one is unavailable with a reason.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin folder mounted at /site/plugins/<name>/ with a bundled index.js appears on the Plugins screen as third-party and can be enabled, proven by building the Docker image and running it with the demo plugin mounted
- [ ] #2 A folder whose module fails to import, exports no plugin, or targets a newer host API version is unavailable with the reason; the site still boots
- [ ] #3 `@geekity/cms/plugin` exports the plugin and host types and definePlugin; an example plugin in apps/demo type-checks against it and runs from the packed tarball (decision-6 smoke)
- [ ] #4 Plugins passed in config.plugins register the same way as mounted and first-party plugins; two plugins with one name refuse to boot with both sources named
- [ ] #5 The Dockerfile creates /site/plugins and sets GEEKITY_PLUGINS_DIR; deploy/compose.yaml has a commented read-only plugins volume beside themes
- [ ] #6 The README has a plugin author section: the plugin shape, requires and services, settings and secrets, the host API version, bundling for the mounted folder, and a warning that a plugin runs with the site's access to data/
<!-- AC:END -->
