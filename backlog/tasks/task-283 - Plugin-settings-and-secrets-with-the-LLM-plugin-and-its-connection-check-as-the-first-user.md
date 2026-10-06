---
id: TASK-283
title: >-
  @geekity/plugin-llm settings: plugin settings and secrets, with a connection
  check
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 13:53'
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
M31 (decision-33). A plugin declares settings fields (text, url, select, checkbox, secret); core draws them as a form on the plugin screen under Plugins and hands the plugin typed values per request. Public values live under plugins[<package name>] in content/_data/site.json; secrets live in data/plugins/<package name>/secrets.json, mode 0600, written atomically. A secret may come from an environment variable instead, named by the package name upper-cased with other runs of characters as _, then the setting (GEEKITY_PLUGIN_LLM_API_KEY for @geekity/plugin-llm), so Docker operators can keep keys in .env; the form then shows it as set by the environment and does not edit it. First user: a new package, packages/plugin-llm (@geekity/plugin-llm), with base URL (default https://openrouter.ai/api/v1), API key (secret) and default model, and a Test connection button that makes one tiny call and reports the outcome. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin declares its settings fields and receives typed values; an invalid stored value falls back to the field default and the screen says so
- [ ] #2 Public values are written under plugins[<package name>] in site.json, keeping keys the settings do not model; secrets are written to data/plugins/<package name>/secrets.json with mode 0600 and never appear in site.json, a page, a log line or an error message
- [ ] #3 A secret set by its environment variable wins over the file, is shown as set by the environment, and the form cannot change it; the screen prints each secret's exact variable name, and a package whose variables would shadow a core GEEKITY_* variable, or two installed packages that map to one prefix, refuse to load with both named
- [ ] #4 A secret field shows whether it is set, never its value; saving the form with the secret blank keeps the stored secret
- [ ] #5 The llm plugin screen has base URL, API key and default model; Test connection reports success with the model that answered, or the typed failure (unconfigured, unauthorized, no credit, rate limited, unavailable, network) in plain words
- [ ] #6 The llm package calls the provider with the built-in fetch and has no SDK dependency
- [ ] #7 The README env table lists how a plugin's variable names are formed from its package name and the data table lists data/plugins/<package name>/
- [ ] #8 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
<!-- AC:END -->
