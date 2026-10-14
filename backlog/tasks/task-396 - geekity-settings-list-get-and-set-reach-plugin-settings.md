---
id: TASK-396
title: 'geekity settings list, get and set reach plugin settings'
status: To Do
assignee: []
created_date: '2026-10-14 09:07'
labels: []
milestone: m-38
dependencies:
  - TASK-390
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: medium
type: enhancement
ordinal: 352800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since TASK-390 a plugin's settings are a namespace on the settings registry, registered by host.settings when the plugin loads. The geekity settings command (cli.ts) builds the registry with createSettings({ config }) and never loads the site's plugins, so 'geekity settings get @geekity/plugin-llm.default_model' answers that there is no such namespace, and list leaves plugin settings out. An operator should be able to read and change a plugin setting from the shell with the site stopped, the same as a core one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity settings list shows each enabled plugin's settings after the core ones, with source and value, and a secret's value is never printed
- [ ] #2 geekity settings get <plugin namespace>.<key> prints the value in effect and set writes data/plugins/<name>/settings.json or secrets.json through the registry, refusing a value its check refuses and a setting the environment overrides
- [ ] #3 A plugin that is installed but not enabled, or fails to load, is named in a warning and does not stop the core settings from listing
- [ ] #4 docs/cli.md and docs/plugins.md describe it; pnpm lint, typecheck and test pass
<!-- AC:END -->
