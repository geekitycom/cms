---
id: TASK-390
title: >-
  Settings registry wave 4: plugin settings move into data/plugins/<name>/ with
  a migration safe to run twice
status: To Do
assignee: []
created_date: '2026-10-13 16:45'
updated_date: '2026-10-13 22:09'
labels: []
milestone: m-38
dependencies:
  - TASK-388
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: medium
type: feature
ordinal: 349800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 section 7 (wave 4) and section 8. A plugin's host.settings(fields) declares a namespace named by its package name, stored in data/plugins/<name>/ with settings.json (public) and secrets.json (secret). Public values move out of plugins.<name> in content/_data/site.json by a migration that runs at boot before the plugin registry reconciles and is also `geekity settings migrate-plugins`: every key except enabled moves, the plugin file wins over site.json when both hold a key, and running it twice or after a crash converges on the same files. The env prefix stays pluginEnvPrefix(package name), so GEEKITY_PLUGIN_LLM__API_KEY keeps working, and every plugin setting, not only secrets, can be set from the environment. settings.current() returns a Promise, the second plugin API break of the major that wave 3a started. plugins/settings.ts is reduced to what the registry does not cover and the rest is deleted. The optional generic form renderer draws plugin screens from the namespace declaration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 host.settings(fields) registers a namespace on the registry; a reserved or clashing namespace or env prefix is refused and the plugin does not load, named on Admin > Plugins
- [ ] #2 The migration moves every non-enabled key of plugins.<name> from site.json to data/plugins/<name>/settings.json; a test runs it twice and after a simulated crash between its two writes and the files are identical each time; plugins.<name>.enabled stays in site.json
- [ ] #3 `geekity settings migrate-plugins` runs the same migration with the site stopped and logs each plugin moved
- [ ] #4 GEEKITY_PLUGIN_LLM__API_KEY and ACME_PLUGIN_LLM__API_KEY keep working as today; a public plugin setting can also be set from its variable; the plugin screen shows a variable-set value as set by the environment with no box
- [ ] #5 settings.current() returns a Promise; both published plugins are updated; the commit is marked breaking
- [ ] #6 resolvePluginSettings, savePluginSettings, settingValues, accepts, defaultOf, EXPECTED, readSecrets and secretsPath in plugins/settings.ts are deleted; readPluginEntry and updatePluginEntry carry only enabled
- [ ] #7 admin/plugins.ts draws a plugin screen through the generic renderer over the registry, using the field label and hint for layout; a plugin screen test covers a text, url, select, checkbox and secret field
- [ ] #8 docs/plugins.md and docs/configuration.md describe data/plugins/<name>/settings.json, the migration and the environment variables for every setting; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-388 (2026-10-13): host.siteInfo() already returns a Promise, but HOST_API_VERSION is still 1. Raise it to 2 once, in this task, so siteInfo and the async current() ship in one release. Update the four plugins' hostApi in source and package.json, the two demo plugins, docs/plugins.md, the plugin-llm README, and the test fixtures that pin 1, including __testing__/npm-registry.ts. sitePluginRegistry(config, folderPlugins, settings) already takes the registry; plugins/enabled.ts reads site.json directly for the enabled set.
<!-- SECTION:NOTES:END -->
