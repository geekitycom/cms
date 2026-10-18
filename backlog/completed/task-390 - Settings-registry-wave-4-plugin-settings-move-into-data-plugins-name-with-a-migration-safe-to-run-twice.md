---
id: TASK-390
title: >-
  Settings registry wave 4: plugin settings move into data/plugins/<name>/ with
  a migration safe to run twice
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:45'
updated_date: '2026-10-14 01:21'
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
- [x] #1 host.settings(fields) registers a namespace on the registry; a reserved or clashing namespace or env prefix is refused and the plugin does not load, named on Admin > Plugins
- [x] #2 The migration moves every non-enabled key of plugins.<name> from site.json to data/plugins/<name>/settings.json; a test runs it twice and after a simulated crash between its two writes and the files are identical each time; plugins.<name>.enabled stays in site.json
- [x] #3 `geekity settings migrate-plugins` runs the same migration with the site stopped and logs each plugin moved
- [x] #4 GEEKITY_PLUGIN_LLM__API_KEY and ACME_PLUGIN_LLM__API_KEY keep working as today; a public plugin setting can also be set from its variable; the plugin screen shows a variable-set value as set by the environment with no box
- [x] #5 settings.current() returns a Promise; both published plugins are updated; the commit is marked breaking
- [x] #6 resolvePluginSettings, savePluginSettings, settingValues, accepts, defaultOf, EXPECTED, readSecrets and secretsPath in plugins/settings.ts are deleted; readPluginEntry and updatePluginEntry carry only enabled
- [x] #7 admin/plugins.ts draws a plugin screen through the generic renderer over the registry, using the field label and hint for layout; a plugin screen test covers a text, url, select, checkbox and secret field
- [x] #8 docs/plugins.md and docs/configuration.md describe data/plugins/<name>/settings.json, the migration and the environment variables for every setting; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Registry: add folder storage (data/plugins/<name>/ with settings.json public and secrets.json secret at 0600). Reads build one view from both files, each setting from its own file; set writes only the files whose settings it changes, under both locks. register refuses an env prefix another registered namespace already uses.
2. plugins/settings.ts: keep pluginFolderPath and settingFieldsProblem, add pluginNamespace(name, fields), which maps the five field types to SettingTypes (text, web url, oneOf, boolean, secret text). Delete resolvePluginSettings, savePluginSettings, settingValues, accepts, defaultOf, EXPECTED, readSecrets, secretsPath, pluginVariable.
3. plugins/registry.ts: options take the SettingsRegistry instead of env. host.settings registers the namespace and current() returns registry.values(namespace), a Promise. Reserved and shared-prefix names are refused before register runs, so the plugin does not load. RegisteredPlugin carries settingsNamespace in place of settingsPlace. PluginScreen.render may return a Promise.
4. plugins/migrate-settings.ts: migratePluginSettings({contentDir,dataDir,log}) moves every non-enabled key of plugins.<name> into data/plugins/<name>/settings.json (the file wins), then strips the moved keys from site.json. It is synchronous and idempotent. Boot runs it before sitePluginRegistry. geekity settings migrate-plugins runs it and logs each plugin moved. plugins/enabled.ts: readPluginEntry and updatePluginEntry carry only enabled.
5. admin/settings-renderer.ts: a generic renderer over {ref,label,hint,widget,options}. It builds field views from resolve() (value via toText, env-set fields with no box and named, stored-value problems) and saves a form through set (blank text removes the key, blank secret keeps it, forget removes it, an overridden field is skipped). admin/plugins.ts and screen.njk draw plugin settings through it.
6. HOST_API_VERSION 1 -> 2: the four plugins in source and package.json, the demo plugins, docs, the plugin-llm README, test fixtures, __testing__/npm-registry.ts and scripts fixtures. plugin-llm and plugin-tag-suggest await current().
7. Tests first for each AC: registry folder storage; migration twice and after a crash; CLI migrate-plugins; env for a secret and a public setting; Admin > Plugins refusal for reserved and clashing names; a plugin screen with text, url, select, checkbox and secret.
8. Docs: plugins.md, configuration.md (Plugin settings), the plugin-llm README. Verify with build, test, typecheck, lint and format:check, then a scratch demo boot with a curl of Admin > Plugins.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-388 (2026-10-13): host.siteInfo() already returns a Promise, but HOST_API_VERSION is still 1. Raise it to 2 once, in this task, so siteInfo and the async current() ship in one release. Update the four plugins' hostApi in source and package.json, the two demo plugins, docs/plugins.md, the plugin-llm README, and the test fixtures that pin 1, including __testing__/npm-registry.ts. sitePluginRegistry(config, folderPlugins, settings) already takes the registry; plugins/enabled.ts reads site.json directly for the enabled set.

Built (2026-10-13):
- Registry: NamespaceStorage gains kind 'folder' (data/<path>/ with publicFile and secretFile). Each setting lives in the file its secret flag picks. A read builds one view from both files, so a key put in the wrong file is ignored. set locks both files, writes only the files whose settings it changes, and writes the secret file at 0600. A stored-value problem names the file, e.g. 'in plugins/@acme/plugin-llm/settings.json'. register refuses an envPrefix that a registered namespace already has. A single-file namespace no longer writes its file on a set with no changes; no caller relied on that.
- plugins/settings.ts is down to pluginFolderPath, settingFieldsProblem and pluginNamespace(name, fields). That function maps text->text, url->webUrl, select->oneOf, checkbox->boolean and secret->secretText (default undefined, secret: true). The description is the hint or the label. resolvePluginSettings, savePluginSettings, settingValues, accepts, defaultOf, EXPECTED, readSecrets, secretsPath and pluginVariable are deleted.
- plugins/registry.ts: PluginRegistryOptions takes settings: SettingsRegistry instead of env. host.settings registers the namespace, and current() is settings.values(namespace), a Promise. A failed register unregisters the namespace. A reserved name or a shared env prefix is now refused before register runs, so the plugin never loads and registers nothing. The messages are unchanged and still shown on Admin > Plugins. RegisteredPlugin.settingsPlace is replaced by settingsNamespace. PluginScreen.render may return a Promise.
- plugins/enabled.ts carries only enabled. readPluginEntry had no caller left, so it is deleted. updatePluginEntry is private and takes enabled: boolean. pluginsOf is exported for the migration.
- plugins/migrate-settings.ts migratePluginSettings({contentDir,dataDir,log}) is synchronous. It writes settings.json as {...rest, ...current} (the file wins), then strips the moved keys from site.json, and writes site.json only when something moved. Names that are not npm package names are skipped. cms/boot.ts runs it after migrateSettingsToFile and before sitePluginRegistry, logging with console.log. geekity settings migrate-plugins runs it and prints each move, or 'No plugin settings are left in content/_data/site.json.'.
- admin/settings-renderer.ts is the generic renderer: settingsForm(body), settingViews(settings, envPrefix, fields, refused) and saveSettings(settings, namespace, fields, form). A field an env/config override holds has no box, shows the value in effect (never a secret) and what sets it, and a save skips it. A blank text box removes the key; a blank secret keeps it; forget removes it; a parse problem reads '<label> <problem>.' admin/components/setting-fields.njk draws the fields. admin/plugins.ts and pages/plugins/screen.njk use both, and the screen note names data/plugins/<name>/settings.json.
- HOST_API_VERSION is 2. hostApi was raised in the four plugins (source and package.json), the demo plugins and their test, docs/plugins.md, the plugin-llm README, the test fixtures (cli-help, cli-plugins, cli-reload, plugin-bundle, folder, install, release, plugin-llm service test), __testing__/npm-registry.ts, scripts/lib/fake-npm-registry.mjs, scripts/pack-install-smoke.sh and the build-plugin-bundle.js comment. plugin-llm connectionFrom and its screen render await current(); plugin-tag-suggest awaits current().
- Tests: registry folder storage and the prefix clash (failed first: 'Cannot read properties of undefined (reading kept)', 'Missing expected exception'). plugins/settings.test.ts was rewritten: Promise current(), files, problems naming the file, ACME_ and GEEKITY_PLUGIN_LLM__API_KEY, a public variable, reserved/clash not loaded (failed first, 8 of 9). plugins/migrate-settings.test.ts covers the move, a second run with identical bytes, a simulated crash (site.json restored after the first write, then rerun, identical to a clean run) and the file winning (failed first: module not found). cli-settings migrate-plugins (failed before the verb existed). admin/plugins.test.ts: a screen with text/url/select/checkbox/secret fields with label and hint, save to settings.json/secrets.json, an env-set public setting with no box, boot migration, and a reserved name on Admin > Plugins. __testing__/plugin-registry-options.ts gives each registry test its own settings registry.
- Docs: configuration.md 'Plugin secrets' became 'Plugin settings', with a subsection on the migration. plugins.md covers settings, async current() and render. cli.md has a migrate-plugins row. The plugin-llm README has a settings table with the variables.

Verification: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check exit 0 (cms 5884, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106). Scratch demo (copy in the scratchpad, plugin-llm bundle in GEEKITY_PLUGINS_DIR, site.json plugins.@geekity/plugin-llm with base_url and default_model, GEEKITY_PLUGIN_LLM__API_KEY and GEEKITY_PLUGIN_LLM__BASE_URL set, served on 4390). Boot logged the move. site.json kept {enabled:true}. Signed in as ada: Admin > Plugins shows LLM enabled. The LLM screen shows Base URL https://env.example/v1 and the API key as set by their variables, with no box and the secret not on the page. The default model box holds the migrated openai/gpt-4.1-mini. A save wrote default_model to settings.json, left base_url as stored and created no secrets.json. On a second copy, geekity settings migrate-plugins printed the move, then 'No plugin settings are left...' on the rerun. Server stopped (pid checked by cwd).

AC #5: current() returns a Promise and both published plugins are updated. The breaking-change marker lives in the commit message, which the orchestrator writes, so #5 stays unchecked and the task stays In Progress until that commit lands.
Not done (outside the ACs): geekity settings list/get/set builds a core-only registry, so plugin namespaces are not listed or settable from the CLI.

Review fixes (2026-10-13): a plugin command now runs migratePluginSettings before it loads the plugins, so it reads migrated settings (test in cli-plugins.test.ts failed first: printed 'greeting: Hello'). The secret field type is nonEmptyText with secret: true; an env value is taken as the variable holds it, as on origin/main (test failed first: 'sk-env' for ' sk-env '); the form still trims. migratePluginSettings reads site.json once and moves each plugin in one loop, writing every plugin file before site.json once. The registry builds one raw-values record for every storage kind, fileFor matches on the key over a non-empty file list, and set carries each draft with its file. The plugin registry builds the rendered settings in register; RenderedSetting moved to settings/types.ts so plugins/ does not import admin/. The checkbox save goes through type.toJson. build, test (cms 5886), typecheck, lint and format:check pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugin settings are now a registry namespace per package, kept in data/plugins/<name>/settings.json and secrets.json, with every setting settable from <PREFIX>__<KEY>. A synchronous, idempotent migration runs at boot, before a plugin command, and as geekity settings migrate-plugins. settings.current() returns a Promise and HOST_API_VERSION is 2, shipped as the breaking commit f046118b. Plugin screens draw through admin/settings-renderer.ts from rendered settings built in register. plugins/settings.ts lost its resolver and saver. Verified with build, test, typecheck, lint and format:check (all pass), the migration twice/crash tests, and a scratch demo boot with curl of Admin > Plugins and the LLM screen.
<!-- SECTION:FINAL_SUMMARY:END -->
