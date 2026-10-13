---
id: TASK-386
title: >-
  Settings registry wave 1: build the registry with maintenance and dev mode as
  first users
status: To Do
assignee: []
created_date: '2026-10-13 16:45'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
priority: high
type: feature
ordinal: 345800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 designs one settings registry over namespaced files. This task builds it under packages/cms/src/settings/ and moves its two first users onto it: maintenance (data/maintenance.json, namespace `maintenance`, keys `on` and `until`) and dev mode (data/dev-mode.json, namespace `dev_mode`, key `on`). Both get admin switches under Tools. `geekity maintenance` and `geekity dev-mode` become thin layers over a new `geekity settings` command (list, get, set). The old one-off code in maintenance.ts, dev-mode.ts, cms/boot.ts and cli.ts is deleted in the same PR. The override order is env `GEEKITY_<NS>__<KEY>`, then the declaration's `override(config)`, then the file, then the default. `GEEKITY_MAINTENANCE` and `config.maintenance` stay as the override of `maintenance.on`. `GEEKITY_DEV_MODE` and `config.devMode` stay a boot latch that writes `dev_mode.on` true through `set`, not an override (decision-35). Read decision-53 sections 1 to 6, 7 (wave 1), 9 and 10 before planning.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A SettingsRegistry (async get, resolve, values, set, list, register, unregister) resolves every declared setting as env, then override(config), then file, then default, and reports the source of the value in effect
- [ ] #2 The `maintenance` and `dev_mode` namespaces are declared with file, data class, settings, descriptions and env prefix; a file written by the previous CLI (presence means on) is read as on through the legacy reader, and the next write stores `{ "on": true }`
- [ ] #3 A plugin whose namespace is a reserved core namespace, or whose env prefix is GEEKITY or a core prefix, is refused with a message naming the clash; a test covers a plugin named `site` and one named `@geekity/maintenance`
- [ ] #4 `set` refuses a key an override is in effect for, naming the source, and writes nothing for the whole call when any key has a problem
- [ ] #5 A change hook on `dev_mode.on` appends the on and off entries to data/dev-mode.jsonl with `by` recorded as config, command or admin; turning dev mode off from the admin or the CLI records when the site went live, and Tools > Dev mode lists it
- [ ] #6 Tools > Maintenance turns maintenance on and off and sets the expected-back time; Tools > Dev mode has a switch; each shows when GEEKITY_MAINTENANCE, GEEKITY_DEV_MODE or the config overrides or latches it and refuses the save with that sentence
- [ ] #7 `geekity settings list`, `get` and `set` work as decision-53 section 10 describes, including the printed source and the stored value for an overridden setting and `(set)` for a secret
- [ ] #8 `geekity maintenance on|off|status` and `geekity dev-mode on|off|status` keep their names and printed sentences, are implemented over the registry, and cli-maintenance.test.ts and cli-dev-mode.test.ts pass
- [ ] #9 maintenance.ts enterMaintenance, leaveMaintenance, readMaintenance and MaintenanceWindow, dev-mode.ts enterDevMode, leaveDevMode and devModeOn, and the direct enterDevMode call in cms/boot.ts are deleted; holdOutbound reads the registry; the renderer takes dev mode as an input rather than reading it
- [ ] #10 settings-boundary.test.ts fails when a file under settings/ imports from admin/, web/, cms/, plugins/ or cli.ts, is shown to fail on a deliberately added import before it is removed, and settings/ is a layer below site/ in layer-boundary.test.ts
- [ ] #11 docs/public-site.md, docs/deploying.md and a new section in docs/configuration.md or docs/settings.md describe the admin switches and `geekity settings`; pnpm lint, typecheck and test pass
<!-- AC:END -->
