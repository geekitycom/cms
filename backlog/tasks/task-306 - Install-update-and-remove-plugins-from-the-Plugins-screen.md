---
id: TASK-306
title: 'Install, update and remove plugins from the Plugins screen'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 01:56'
updated_date: '2026-10-09 03:29'
labels: []
dependencies:
  - TASK-305
references:
  - packages/cms/src/admin/plugins.ts
  - packages/cms/src/plugins/install.ts
  - packages/cms/admin/pages/plugins/installed.njk
priority: medium
type: feature
ordinal: 266800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a Docker site adds, upgrades and removes plugins with `geekity plugin add|upgrade|remove` and then presses Reload. Andrew wants the same from the admin, as WordPress does. This lets an admin session put new code on the server, so it is guarded: on by default (Andrew's call, 2026-10-09) with an environment switch to turn it off, a password confirmation, the same verified install as the CLI, and a record of who did what. Adding is by package name; browsing a catalogue is out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admin > Plugins has an Add plugin form that takes a package name and optional version or range, and installs it into the plugins folder with the same verified install and checks as `geekity plugin add` (integrity hash, bundle and manifest, host API and ranges); the outcome and any missing or out-of-range requirements are shown on the screen
- [x] #2 Each folder-installed plugin row has Update (when a newer compatible version exists, using TASK-305's upgrade logic) and Remove, and the screen has Update all; after any change the screen offers Reload, which loads it without a container restart
- [x] #3 Install, update and remove ask for the current user's password and refuse without it; every request needs the session and CSRF token like other admin forms
- [x] #4 `GEEKITY_PLUGIN_INSTALL=off` hides these controls and refuses the requests with a clear message; it is on when unset, and the README documents the switch and the risk (a plugin runs as the site with access to data/ and the plugin secrets)
- [x] #5 Plugins passed in the site config (a site with its own server.ts) are shown as managed in code and get no install, update or remove controls
- [x] #6 Each install, update and removal is recorded with who, when, the package and the versions, and the record is visible to the owner
- [x] #7 Tests cover the form, the password check, the switch, update and remove against a local fake registry; the browser path is driven in Playwright; doc-5 Admin UI and the README are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Config: pluginInstall (GEEKITY_PLUGIN_INSTALL, on by default) on the resolved config; one registry helper (npm_config_registry, default registry.npmjs.org) shared by cli.ts and the admin.
2. src/plugins/changes.ts: the record of admin plugin changes in data/plugin-changes.json (who, when, action, package, from/to), newest first, bounded, mode 0600.
3. Move cli.ts's upgrade line wording into upgrade.ts so the CLI and the screen say the same thing.
4. Admin > Plugins: Add form (package, version or range, password) inline; Check for updates (cached in the worker); per folder row Update (when the check found one) and Remove; Update all. Update, Update all and Remove go through a confirm screen that names what will change and asks for the password. All POSTs need session + CSRF; password checked with verifyUserPassword; one change at a time per plugins folder (withFileLock); outcome as flashes; Reload card then applies. New paths reserved. Config plugins show 'managed in code' with no controls. Switch off: no controls, a note, and every request refused.
5. Recent changes table on the screen from the record.
6. Tests against the fake npm registry (new src/admin/plugins-install.test.ts); README Docker section + config table; doc-5 and doc-1.
7. Verify: full gates, pack-install smoke, Playwright Chromium against a scratch site under geekity serve with the fake registry.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: config pluginInstall (GEEKITY_PLUGIN_INSTALL, default on) and pluginRegistry(env) in install.ts, shared with cli.ts; describeUpgrade moved from cli.ts into upgrade.ts so the CLI and the screen word an upgrade the same way; src/plugins/manage.ts runs add/update/remove one at a time per plugins folder (withFileLock on the folder path) and records each change in data/plugin-changes.json via src/plugins/changes.ts (newest 200, mode 0600); src/plugins/manage.ts also keeps the last Check for updates per folder in the worker, dropped when the folder changes. Admin routes in src/admin/plugins.ts: POST add, check, update, update-all, remove and GET confirm, all reserved from plugin screens. Add is inline with its password; Update, Update all and Remove go through a confirm screen that lists what will change (a live check) and asks for the password. Wrong password: 400 on the same form with the error-summary convention (form-errors.test.ts now covers both templates). Config plugins say Managed in code and get no controls. Remove is offered on every folder plugin, enabled or not, as the CLI does.
Verification: new src/admin/plugins-install.test.ts (14 tests, fake npm registry), with mutants (no password check, no record, switch ignored on POST, config plugins manageable) each failing at least one test; pnpm build/test (cms 5001 pass)/typecheck/lint/format:check green; scripts/pack-install-smoke.sh passed; Playwright (playwright-core 1.48.2 driving Chrome headless) against a scratch site under geekity serve with the fake registry: add refused on a wrong password with the package kept, add llm 1.0.0 and tags 2.0.0, Reload, Check for updates, row Update llm to 1.1.0, Update all tags to 2.1.0, Remove refused then done, Reload, Recent changes lists all five; restarted with GEEKITY_PLUGIN_INSTALL=off: no controls, the switch named, a forged add refused with the reason. Phone width 390 has no horizontal overflow. Servers and the registry stopped afterwards.

Follow-ups Andrew accepted after review (2026-10-08):
- Remove now needs the plugin disabled first, as WordPress does. An enabled plugin's row has no Remove; the confirm screen shows "<name> is enabled. Disable it first." with nothing to press; the POST refuses with that flash; and `geekity plugin remove` exits 1 with the same message (removePlugin in src/plugins/install.ts reads the enabled set from site.json, so the screen and the CLI share the rule). This replaces "Remove is offered on every folder plugin, enabled or not, as the CLI does" above. Tests: plugins-install.test.ts (row, confirm, POST, then Remove back after Disable) and cli-plugin-add.test.ts (CLI refusal, folder kept).
- A missing requirement flashed on the screen says "Add <package> with the Add plugin form." instead of the command line; the CLI keeps "Add it with: geekity plugin add <package>". requirementNotes and upgradePlugins take the advice as an AddAdvice (ADD_WITH_COMMAND in install.ts, ADD_WITH_FORM in manage.ts). Test: the Add plugin requirement test asserts the form wording and that no flash names geekity plugin add.
- Update checks stay manual (Check for updates), and a failed check is still not recorded: no change.
- README (Docker and Installing from the admin), packages/cms/README.md, the CLI help and doc-5 now say Remove needs a disabled plugin.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admin > Plugins now adds a plugin by package name (optional version, range or tag), checks for updates, updates one folder plugin or all of them, and removes one, through the same install and upgrade code as geekity plugin. Each change needs the session, the CSRF token and the admin's password, runs one at a time per plugins folder, is recorded in data/plugin-changes.json and listed under Recent changes, and is then loaded by the existing Reload. Config plugins show as managed in code. GEEKITY_PLUGIN_INSTALL=off (pluginInstall: false) hides the controls and refuses the requests. README and doc-5/doc-1 updated. Verified by 14 new tests against a fake registry, the full gates, the pack-install smoke and a Playwright run under geekity serve (on and off).
<!-- SECTION:FINAL_SUMMARY:END -->
