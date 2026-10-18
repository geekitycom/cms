---
id: TASK-424
title: A site config loads without loading the whole CMS
status: Done
assignee:
  - '@claude'
created_date: '2026-10-18 13:58'
updated_date: '2026-10-18 14:12'
labels:
  - config
  - cli
  - performance
milestone: m-37
dependencies: []
references:
  - packages/cms/package.json
  - packages/cms/templates/site/geekity.config.ts
  - docs/configuration.md
priority: medium
type: feature
ordinal: 361800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since TASK-374 the geekity command starts in about 0.04 s for commands that only read settings, instead of 0.28 s. A real site loses most of that: the config that geekity init writes (packages/cms/templates/site/geekity.config.ts) and the docs show starts with import { defineConfig } from '@geekity/cms', and that entry point (dist/index.js) loads the whole CMS, about 0.29 s, as soon as any command reads the config. An operator running geekity in a container pays it on every command. defineConfig and the config types need an entry point that loads only the config module, about 0.02 s, as @geekity/cms/plugin already does for plugins. Configs that import from '@geekity/cms' keep working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 @geekity/cms/config exports defineConfig and the config types, and importing it does not load the CMS core, sharp or Fedify
- [x] #2 The config geekity init writes, the demo config, docs/configuration.md and the plugin READMEs import defineConfig from @geekity/cms/config
- [x] #3 A config importing defineConfig from @geekity/cms still works
- [x] #4 geekity settings list on a site whose config imports @geekity/cms/config starts without loading the CMS core, measured against the same site importing @geekity/cms
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/config-entry.ts exporting defineConfig and the config types, mapped as ./config in package.json.
2. Switch the init template, demo, docs and plugin READMEs to @geekity/cms/config.
3. Test the entry's import graph and the pack-install smoke.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured on scratch sites with geekity.config.mjs and a node_modules/@geekity/cms symlink, best of 5 of node dist/cli.js settings list: config importing @geekity/cms 0.29 s and 1374 modules (dist/index.js, sharp, Fedify); importing @geekity/cms/config 0.04 s and 140 modules; no config 0.04 s. Tests: a /config site loads without the core (cli.test.ts), both import paths load {port: 4321}, the config entry's exports match and are all on the root entry (public-api.test.ts), layer map lists config-entry.ts, pack-install smoke imports @geekity/cms/config from the tarball. The loaded-module list is written to a file (GEEKITY_TEST_LOADED_MODULES) because a write to a pipe in an exit handler stops at 64 KB.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
@geekity/cms/config exports defineConfig and the config types without loading the CMS. The init template, demo, configuration docs and plugin READMEs use it, so a site's geekity settings or maintenance command starts in about 0.04 s instead of 0.29 s. Configs importing from @geekity/cms still work, at the old cost. Verified by startup and export tests, the pack-install smoke, and timing a scratch site both ways.
<!-- SECTION:FINAL_SUMMARY:END -->
