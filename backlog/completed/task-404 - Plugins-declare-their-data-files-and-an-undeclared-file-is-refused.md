---
id: TASK-404
title: 'Plugins declare their data files, and an undeclared file is refused'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 17:21'
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
- [x] #1 A plugin that writes an undeclared file gets an error that names the file and the `data` field.
- [x] #2 `@geekity/plugin-wordpress` declares `actors.json`, `import.json` and `requests.json` as kept. `@geekity/plugin-llm` declares `last-call.json` as rebuildable, and `@geekity/plugin-tag-suggest` declares `followers.json` as rebuildable.
- [x] #3 `siteDataFiles` returns core, settings and loaded plugin declarations. A folder whose plugin is not loaded reads as kept.
- [x] #4 docs/plugins.md documents `data` and the classes a plugin may use.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. plugin.ts: add PluginDataClass ('kept' | 'rebuildable' | 'credential') and an optional `data` map on Plugin (one-segment file name -> class). Remove PluginDataFolder.path. HOST_API_VERSION stays 2 (raised in f046118b, not in v0.31.0).
2. plugins/registry.ts: validate `data` at registration (file name shape, class one of the three, not settings.json/secrets.json); a bad map makes the plugin unavailable. Turn each entry into a DataFileDeclaration under plugins/<name>/ and keep them on RegisteredPlugin.dataFiles. pluginDataFolder(dataDir, plugin) builds every path with dataPath and refuses an undeclared name with an error naming the file and the `data` field. Credential files are written 0600.
3. plugins/data.ts: siteDataFiles({ dataDir, settings, plugins }) = CORE_DATA_FILES + settings.dataFiles() + loaded plugins' declarations + for each folder under data/plugins/ whose plugin is not loaded, secrets.json as credential and the rest as kept.
4. @geekity/cms/testing pluginDataFolder takes the plugin definition; update plugin tests.
5. Declare data in plugin-wordpress (actors/import/requests kept), plugin-llm (last-call rebuildable), plugin-tag-suggest (followers rebuildable); plugin-post-summary keeps no file.
6. Docs: plugins.md (data field, classes, error, testing helper), public-api.md PluginDataFolder row.
7. Verify with build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plugin.data maps a one-segment file name to 'kept' | 'rebuildable' | 'credential' (PluginDataClass). The registry turns it into DataFileDeclarations under plugins/<name>/ (plugins/data.ts pluginDataFiles) before register runs; a bad name, settings.json/secrets.json, or another class makes the plugin unavailable with the reason. pluginDataFolder(dataDir, plugin) builds every path with dataPath and refuses an undeclared name: '<plugin> uses "<file>" in its folder, which its definition does not declare. Add the file to the plugin's `data` field with its class: kept, rebuildable or credential.' Credential files are written 0600. PluginDataFolder.path removed. RegisteredPlugin gains dataFiles and loaded (register ran and returned). siteDataFiles({ dataDir, settings, plugins }) in plugins/data.ts = CORE_DATA_FILES + settings.dataFiles() + loaded plugins' dataFiles + for each folder under data/plugins/ whose plugin is not loaded, secrets.json as credential then ** as kept. It reads data/plugins/ to find those folders, so an undeclared file in a loaded plugin's folder stays undeclared. @geekity/cms/testing pluginDataFolder now takes the plugin definition. HOST_API_VERSION stays 2: it was raised in f046118b, which is not in v0.31.0. plugin-post-summary keeps no file. Failing first: registry.test.ts new cases (missing exception for undeclared, mode not 0600, dataFiles undefined, no problem for bad declarations); plugin-wordpress tests failed with the undeclared-file error before the declarations were added. Validation: pnpm build, test (cms 6038, wordpress 107, llm 49, tag-suggest 32, post-summary 23, demo 32, 0 fail), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugins now declare their data files in a `data` field on the definition, with class kept, rebuildable or credential. host.data refuses an undeclared file with an error naming the file and the `data` field, writes credentials at 0600, and no longer exposes `path`. plugin-wordpress declares actors.json, import.json and requests.json as kept; plugin-llm last-call.json and plugin-tag-suggest followers.json as rebuildable. siteDataFiles (plugins/data.ts) returns core, settings and loaded plugin declarations, and reads a folder whose plugin is not loaded as kept with its secrets.json as a credential. docs/plugins.md and docs/public-api.md describe the field and classes. Verified with registry.test.ts and data.test.ts, per-plugin bundle tests asserting the declarations, and a full build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
