---
id: TASK-283
title: >-
  @geekity/plugin-llm settings: plugin settings and secrets, with a connection
  check
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 15:22'
labels:
  - plugins
  - llm
milestone: m-30
dependencies:
  - TASK-281
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - 'https://openrouter.ai/docs/api-reference/overview'
  - 'https://openrouter.ai/docs/api-reference/errors'
  - packages/cms/src/admin/settings.ts
priority: medium
type: feature
ordinal: 239800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). A plugin declares settings fields (text, url, select, checkbox, secret); core draws them as a form on the plugin screen under Plugins and hands the plugin typed values per request. Public values live under plugins[<package name>] in content/_data/site.json; secrets live in data/plugins/<package name>/secrets.json, mode 0600, written atomically. A secret may come from an environment variable instead, named by the package name, then __, then the setting, each upper-cased with every run of other characters as one _ (GEEKITY_PLUGIN_LLM__API_KEY for @geekity/plugin-llm), so Docker operators can keep keys in .env; the form then shows it as set by the environment and does not edit it. First user: a new package, packages/plugin-llm (@geekity/plugin-llm), with base URL (default https://openrouter.ai/api/v1), API key (secret) and default model, and a Test connection button that makes one tiny call and reports the outcome. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A plugin declares its settings fields and receives typed values; an invalid stored value falls back to the field default and the screen says so
- [x] #2 Public values are written under plugins[<package name>] in site.json, keeping keys the settings do not model; secrets are written to data/plugins/<package name>/secrets.json with mode 0600 and never appear in site.json, a page, a log line or an error message
- [x] #3 A secret set by its environment variable wins over the file, is shown as set by the environment, and the form cannot change it; the screen prints each secret's exact variable name, and two installed packages whose names convert to one variable prefix refuse to load with both named
- [x] #4 A secret field shows whether it is set, never its value; saving the form with the secret blank keeps the stored secret
- [x] #5 The llm plugin screen has base URL, API key and default model; Test connection reports success with the model that answered, or the typed failure (unconfigured, unauthorized, no credit, rate limited, unavailable, network) in plain words
- [x] #6 The llm package calls the provider with the built-in fetch and has no SDK dependency
- [x] #7 The README env table lists how a plugin's variable names are formed from its package name and the data table lists data/plugins/<package name>/
- [x] #8 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core host API (plugin.ts): host.settings(fields) declares typed fields (text, url, select, checkbox, secret) and returns a reader whose current() gives typed values per call; PluginScreen gains actions (a button core draws, runs on POST, and reports as a flash). Field keys are lower snake case so the env name is the key upper-cased.
2. Core settings module (src/plugins/settings.ts): resolve each field from site.json plugins[<name>] (public), data/plugins/<name>/secrets.json (0600, atomic) and the env var <PREFIX>__<KEY>; an invalid stored value falls back to the default with a problem. pluginEnvPrefix(name) converts the package name; the registry marks every installed plugin whose prefix collides unavailable, naming both.
3. enabled.ts: one writer of plugins[<name>] (updatePluginEntry) used by enable/disable and by settings saves, keeping unmodelled keys.
4. Admin: the plugin screen draws a Settings card (env-set secrets read-only with their variable name, secrets show set/not set, blank keeps, a box to forget a stored secret, every secret's variable name printed), POST saves or runs an action. Screen exists for a plugin with settings even without host.screen.
5. packages/plugin-llm: base URL (default https://openrouter.ai/api/v1), API key (secret), default model; Test connection posts one tiny chat completion with built-in fetch and maps the result to ok+model or a typed failure (unconfigured, unauthorized, no-credit, rate-limited, unavailable, network). No SDK dependency. Tests against a local fake server; bundle test.
6. Wiring: release-please config + manifest, commitlint scope, CLAUDE.md scope row, pack-install smoke installs plugin-llm; README env table and data table; plugin README.
7. Verify: pnpm build, test, typecheck, lint, format:check; curl the running demo for the screen and Test connection against a local fake provider.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Settings are declared through host.settings(fields) rather than a manifest field, so the values come back typed (PluginSettingValues maps each field's key to string, boolean, a select's option union, or string | undefined for a secret) with no cast in the plugin. Field keys must be lower snake case, so the env name is the key upper-cased and two keys cannot convert to one variable; 'enabled' is reserved. A bad declaration fails register, so the plugin is unavailable with the reason.
Screen actions (PluginScreen.actions) are the extension point Test connection needed: core draws a button per action, runs it on POST and shows its outcome as an escaped notice or error flash. A plugin with settings but no host.screen still gets a screen, titled with its label.
enabled.ts now has one writer of plugins[<name>] (updatePluginEntry); setPluginEnabled and the settings save both use it. Secrets are written by core with updateFileAtomically at mode 0600; host.data gained no mode option because no plugin writes secrets itself.
Empty public box removes the key so the default applies; blank secret keeps the stored one; 'Forget the stored ...' removes it. Two packages whose prefixes collide are both unavailable, each naming the other; the site still boots (decision-33's 'refuse to load').
Known gap, not fixed: pluginAnchor on Admin > Plugins also collides for @a/b-c and @a-b/c (same row id); harmless because both are refused, but the anchor is not unique.
plugin-llm: connection.ts holds chatCompletion (built-in fetch, 30 s timeout, typed LlmFailure), testConnection and describeFailure. A non-401/402/403/429 error status maps to 'unavailable' with the status and the provider's error.message, with the key replaced. Default model is openrouter/auto. No dependencies at all; a test asserts it.
Validation: pnpm build, pnpm test (cms 4871, plugin-llm 13, plugin-wordpress 36, demo 32, all pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. scripts/pack-install-smoke.sh passes locally with plugin-llm packed, installed, its bundle loaded alone and its screen fetched over HTTP after a curl sign-in. A scratch server with a loopback fake provider was driven with curl: Test connection with no key flashed 'No API key is set, so nothing was sent.'; after save it flashed 'Connected. fake/answerer-1 answered.'; secrets.json mode 600; key absent from page, site.json and server log; with GEEKITY_PLUGIN_LLM__API_KEY set the screen shows 'Set by the environment variable GEEKITY_PLUGIN_LLM__API_KEY' and no box. commitlint accepts feat(plugin-llm) and rejects an unknown scope. GitHub CI has not run this branch yet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugins can now declare settings fields (text, url, select, checkbox, secret) with host.settings and read typed values per request. Core draws them as a form on the plugin's screen, keeps public values under plugins[<name>] in site.json, secrets in data/plugins/<name>/secrets.json at 0600, and lets <PACKAGE>__<KEY> env variables win and lock the field. Screens gained actions. New package @geekity/plugin-llm (base URL, API key, default model, Test connection with built-in fetch, no SDK), registered with release-please, commitlint, CLAUDE.md, and the pack-install smoke. Verified with pnpm build/test/typecheck/lint/format:check, the pack-install smoke, and curl against a booted site with a loopback fake provider.
<!-- SECTION:FINAL_SUMMARY:END -->
