---
id: TASK-396
title: 'geekity settings list, get and set reach plugin settings'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 09:07'
updated_date: '2026-10-14 09:56'
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
- [x] #1 geekity settings list shows each enabled plugin's settings after the core ones, with source and value, and a secret's value is never printed
- [x] #2 geekity settings get <plugin namespace>.<key> prints the value in effect and set writes data/plugins/<name>/settings.json or secrets.json through the registry, refusing a value its check refuses and a setting the environment overrides
- [x] #3 A plugin that is installed but not enabled, or fails to load, is named in a warning and does not stop the core settings from listing
- [x] #4 docs/cli.md and docs/plugins.md describe it; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in cli-settings.test.ts: a site whose config installs an enabled plugin with text, select, url and secret settings, a disabled plugin with settings, and a plugin whose register throws. list shows core then the enabled plugin's settings with source and value, never the secret; get prints the value in effect; set writes data/plugins/<name>/settings.json or secrets.json; a value the select refuses and an env-overridden setting are refused without writing; the disabled and failed plugins are named in warnings on stderr and core still lists.
2. cli.ts: reuse the loading path pluginCommand uses. Extract the plugin loading of pluginCommands into one helper that takes the settings registry, so geekity settings loads the site's plugins fully (register runs, as for a plugin command) on the same registry. Run migratePluginSettings first, as pluginCommand does, so get reads what a boot would. Unregister the namespace of a plugin that is installed but not enabled, and warn on stderr for it and for each plugin with a problem.
3. Docs: docs/cli.md and docs/plugins.md.
4. Verify: build, test, typecheck, lint, format:check, then the real CLI on a scratch demo copy with plugin-llm.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built (2026-10-14):
- Design choice: geekity settings loads the site's plugins fully, through the same path a plugin command uses. pluginCommands' loading moved into loadSitePlugins(config, settings) in cli.ts, which both callers use, so there is one loading path. register runs, as it does for a plugin command; it only declares things, and nothing is started (reconcile is not called).
- settingsWithEnabledPlugins(config) runs migratePluginSettings first (logging to stderr, so stdout stays the table), as pluginCommand does, so get reads what a boot would. It then loads the plugins on the command's registry. A plugin with a problem is named on stderr as '<name> did not load: <problem> Its settings are not listed.' An installed plugin that declared settings but is not enabled is named as '<name> is installed but not enabled. Its settings are not listed.', and its namespace is unregistered, so list, get and set do not reach it. A disabled plugin with no settings is not named, since it has nothing left out.
- migrate-plugins is unchanged and does not load plugins.
- Help text for settings list and its snapshot in cli-help.test.ts gained one sentence. docs/cli.md (settings row), docs/plugins.md (a geekity settings paragraph with an example) and docs/settings.md (Runtime settings) describe it.
- Tests first in cli-settings.test.ts with a config that installs an enabled plugin (text, select, url, secret), a disabled one with settings, and one whose register throws. Before the change all four failed: list had no @acme/plugin-llm line, stderr was empty, and get/set said 'There is no setting @acme/plugin-llm.tone'.
- Left as is: a DuplicatePluginError (two plugins with one name) still stops the command, as it stops a boot.

Verification: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check exit 0 (cms 5897, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106). Real CLI on a scratch copy of apps/demo with the plugin-llm bundle in GEEKITY_PLUGINS_DIR and plugins.@geekity/plugin-llm {enabled:true, default_model} in site.json: list printed core then @geekity/plugin-llm base_url (default), api_key '(set) env GEEKITY_PLUGIN_LLM__API_KEY' and default_model (file, migrated, move logged on stderr); the env secret value appeared in neither stdout nor stderr. get printed openai/gpt-4.1-mini. set default_model wrote settings.json; set api_key wrote secrets.json at mode 0600 and printed (set). set base_url not-a-url exited 1 with 'must be an http:// or https:// URL.'; with GEEKITY_PLUGIN_LLM__BASE_URL set, set base_url exited 1 with 'is set by GEEKITY_PLUGIN_LLM__BASE_URL and cannot be changed here.' and settings.json was unchanged. With the plugin disabled, list exited 0, printed core settings, no plugin-llm lines, and warned '@geekity/plugin-llm is installed but not enabled. Its settings are not listed.'

Review follow-up: settings list/get/set now check the verb and its arguments before anything else (a parsed settingsRequest), so geekity settings bogus or get with no name migrates and loads nothing. When loadSitePlugins throws (for example DuplicatePluginError) the command writes 'Plugin settings are not listed: <message>' to stderr and carries on with the core registry, so settings set maintenance.on true still works. Plugin settings are listed only for plugins in registry.active(enabled), the set the server runs; a plugin that is enabled but needs a plugin that is not running is warned about and its settings unregistered. 'Its settings are not listed.' is printed only for a plugin that declares settings. The shared loader still loads every installed plugin, as pluginCommands does, and unregisters the ones not running afterwards. Four new tests in cli-settings.test.ts failed before the fix. Help, docs/cli.md, settings.md and plugins.md say running instead of enabled.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity settings list, get and set now reach each enabled plugin's settings. The command loads the site's plugins through loadSitePlugins, the path a plugin command already used, after running the plugin settings migration as a plugin command does. A plugin that did not load, or that is installed but not enabled, is named on stderr and its namespace is left out; the core settings still list. Verified by four new cli-settings tests (failing before the change), the full build/test/typecheck/lint/format:check run, and the real CLI on a scratch demo copy with plugin-llm: list, get, set to settings.json and secrets.json (0600), a refused URL, an env-overridden set, a secret never printed, and the disabled-plugin warning.
<!-- SECTION:FINAL_SUMMARY:END -->
