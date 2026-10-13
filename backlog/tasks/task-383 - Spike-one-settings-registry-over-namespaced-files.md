---
id: TASK-383
title: 'Spike: one settings registry over namespaced files'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-13 12:10'
updated_date: '2026-10-13 16:46'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: high
type: spike
ordinal: 342800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 puts every runtime setting behind one registry. Today there are two: core rows in site/setting-rows.ts over content/_data/site.json, and plugin settings declared with host.settings() (plugins/settings.ts), with public values under plugins.<name> in site.json and secrets in data/plugins/<name>/secrets.json. Mail and Akismet credentials (data/mail.json, data/akismet.json), maintenance (data/maintenance.json) and dev mode (data/dev-mode.json) each have their own one-off code. This spike designs the registry; it builds nothing for production.

Settled already (decision-52), to design within:
- A setting is namespace.key. Each namespace declares its file and its data class (kept or rebuildable, and whether it holds secrets). Core keeps site.json, each plugin gets its own file, secrets and runtime flags stay under data/.
- The registry reads every file and resolves config or env, then the file, then the default, behind one async interface for the admin and the CLI. A future farm could use the same interface, but nothing is designed for it here.
- The env variable is GEEKITY_<NAMESPACE>__<KEY>; a namespace never contains a double underscore, as GEEKITY_PLUGIN_LLM__API_KEY works today. Core namespaces are reserved and a plugin whose namespace clashes is refused.
- The registry owns only the data contract: key, type, default, validation, storage, whether it is a secret, override and change hook, plus a short description for the CLI. Admin pages are written on their own, refer to settings by key and choose their own layout, labels and widgets. A generic form renderer is optional. The registry imports nothing from admin/.
- The first users are maintenance and dev mode, which get admin switches; their CLI commands stay as thin layers over a generic geekity settings command. Dev mode going off must still record when the site went live, through a change hook.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision record gives the registry interface, the namespace declaration (file, data class, settings), the setting declaration (type, default, validation, secret or not, override, change hook, description) and the override order, with the namespaces core reserves
- [x] #2 The record maps every current core setting, plugin setting, credential file and runtime flag to its namespace and file, and says which existing code is deleted when it moves
- [x] #3 The record says how plugin public values move out of plugins.<name> in site.json into their own files, with a migration safe to run twice, and how a plugin keeps its env names
- [x] #4 The record says whether GEEKITY_MAINTENANCE and GEEKITY_DEV_MODE keep their names as aliases or move to the namespaced form, and what a site that sets them must change
- [x] #5 The record shows a custom admin page and the optional generic renderer both reading and saving through the registry, and names the test that keeps the registry from importing admin code
- [x] #6 The record defines the geekity settings CLI (list, get, set) and how it shows a value that config or env overrides
- [x] #7 Follow-up tasks are filed for building the registry with maintenance and dev mode as its first users and for moving every other setting onto it; nothing is built for production in this task
- [ ] #8 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read decision-52, the milestone and the current settings code (site/setting-rows.ts, site/settings.ts, site/site-json.ts, settings-form.ts, admin settings pages, plugins/settings.ts, plugin.ts host.settings, mail/credentials.ts, comments/akismet.ts, maintenance.ts, dev-mode.ts, config.ts ENV_SETTINGS, cli.ts, docs/).
2. Inventory every setting, credential and runtime flag with its file, reader and writer.
3. Settle open questions by reading code or a throwaway experiment (env name parsing, site.json write path, plugin settings file shape, migration idempotence).
4. Write the decision record (proposed): registry types, namespace and setting declarations, override order, reserved namespaces, mapping table, plugin migration, env alias decision, admin page and renderer examples, boundary test, CLI.
5. File follow-up tasks under m-38 with dependencies, referencing the decision.
6. Check the acceptance criteria with evidence; leave AC#8 for the user's review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-53 (proposed) holds the design. Checks run: pluginEnvPrefix on seven package names (plugin env names keep the package-derived prefix, which departs from decision-52's wording); a throwaway migration script run twice and after a simulated crash (idempotent, file wins); a census of 98 call sites of readSiteSettings, devModeOn, holdOutbound, readMailCredentials and readAkismetKey (32 async, 39 one hop from async, 12 in sync-only chains, named in the record). Follow-ups filed under m-38: TASK-386 (wave 1, registry + maintenance + dev mode + admin switches + geekity settings), TASK-387 (wave 2 credentials, dep 386), TASK-388 (wave 3a site namespace readers, dep 386), TASK-389 (wave 3b pages save through the registry, dep 388), TASK-390 (wave 4 plugins + migration, dep 388). AC#8 waits for the user to read and accept decision-53; the task stays In Progress and no follow-up is started before then.
<!-- SECTION:NOTES:END -->
