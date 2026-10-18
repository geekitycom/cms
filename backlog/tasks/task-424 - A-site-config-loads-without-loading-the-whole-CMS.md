---
id: TASK-424
title: A site config loads without loading the whole CMS
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-18 13:58'
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
- [ ] #1 @geekity/cms/config exports defineConfig and the config types, and importing it does not load the CMS core, sharp or Fedify
- [ ] #2 The config geekity init writes, the demo config, docs/configuration.md and the plugin READMEs import defineConfig from @geekity/cms/config
- [ ] #3 A config importing defineConfig from @geekity/cms still works
- [ ] #4 geekity settings list on a site whose config imports @geekity/cms/config starts without loading the CMS core, measured against the same site importing @geekity/cms
<!-- AC:END -->
