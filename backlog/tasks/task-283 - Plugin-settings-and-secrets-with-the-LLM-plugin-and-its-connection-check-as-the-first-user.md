---
id: TASK-283
title: >-
  Plugin settings and secrets, with the LLM plugin and its connection check as
  the first user
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
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
M31 (decision-33). A plugin declares settings fields (text, url, select, checkbox, secret); core draws them as a form on the plugin screen under Plugins and hands the plugin typed values per request. Public values live under `plugins.<name>` in content/_data/site.json; secrets live in `data/plugins/<name>.json`, mode 0600, written atomically. A secret may come from `GEEKITY_PLUGIN_<NAME>_<SETTING>` instead, so Docker operators can keep keys in .env; the form then shows it as set by the environment and does not edit it. First user: an `llm` plugin under packages/cms/plugins/llm/ with base URL (default https://openrouter.ai/api/v1), API key (secret) and default model, and a Test connection button that makes one tiny call and reports the outcome.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin declares its settings fields and receives typed values; an invalid stored value falls back to the field default and the screen says so
- [ ] #2 Public values are written under plugins.<name> in site.json, keeping keys the settings do not model; secrets are written to data/plugins/<name>.json with mode 0600 and never appear in site.json, a page, a log line or an error message
- [ ] #3 A secret set by GEEKITY_PLUGIN_<NAME>_<SETTING> wins over the file, is shown as set by the environment, and the form cannot change it
- [ ] #4 A secret field shows whether it is set, never its value; saving the form with the secret blank keeps the stored secret
- [ ] #5 The llm plugin screen has base URL, API key and default model; Test connection reports success with the model that answered, or the typed failure (unconfigured, unauthorized, no credit, rate limited, unavailable, network) in plain words
- [ ] #6 The README env table lists the GEEKITY_PLUGIN_ variable pattern and the data table lists data/plugins/
<!-- AC:END -->
