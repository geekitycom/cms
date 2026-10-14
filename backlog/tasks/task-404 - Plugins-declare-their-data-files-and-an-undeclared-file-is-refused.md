---
id: TASK-404
title: 'Plugins declare their data files, and an undeclared file is refused'
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-403
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 360800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `data` map to the plugin definition. `PluginDataFolder.read` and `update` refuse an undeclared name, and `path` is removed. The three published plugins that keep files declare them as in the table. The change is released with decision-53's plugin breaks.

From decision-55 (accepted), proposed task 2. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin that writes an undeclared file gets an error that names the file and the `data` field.
- [ ] #2 `@geekity/plugin-wordpress` declares `actors.json`, `import.json` and `requests.json` as kept. `@geekity/plugin-llm` declares `last-call.json` as rebuildable, and `@geekity/plugin-tag-suggest` declares `followers.json` as rebuildable.
- [ ] #3 `siteDataFiles` returns core, settings and loaded plugin declarations. A folder whose plugin is not loaded reads as kept.
- [ ] #4 docs/plugins.md documents `data` and the classes a plugin may use.
<!-- AC:END -->
