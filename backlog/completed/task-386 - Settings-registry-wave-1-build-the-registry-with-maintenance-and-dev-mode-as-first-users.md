---
id: TASK-386
title: >-
  Settings registry wave 1: build the registry with maintenance and dev mode as
  first users
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:45'
updated_date: '2026-10-13 18:40'
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
- [x] #1 A SettingsRegistry (async get, resolve, values, set, list, register, unregister) resolves every declared setting as env, then override(config), then file, then default, and reports the source of the value in effect
- [x] #2 The `maintenance` and `dev_mode` namespaces are declared with file, data class, settings, descriptions and env prefix; a file written by the previous CLI (presence means on) is read as on through the legacy reader, and the next write stores `{ "on": true }`
- [x] #3 A plugin whose namespace is a reserved core namespace, or whose env prefix is GEEKITY or a core prefix, is refused with a message naming the clash; a test covers a plugin named `site` and one named `@geekity/maintenance`
- [x] #4 `set` refuses a key an override is in effect for, naming the source, and writes nothing for the whole call when any key has a problem
- [x] #5 A change hook on `dev_mode.on` appends the on and off entries to data/dev-mode.jsonl with `by` recorded as config, command or admin; turning dev mode off from the admin or the CLI records when the site went live, and Tools > Dev mode lists it
- [x] #6 Tools > Maintenance turns maintenance on and off and sets the expected-back time; Tools > Dev mode has a switch; each shows when GEEKITY_MAINTENANCE, GEEKITY_DEV_MODE or the config overrides or latches it and refuses the save with that sentence
- [x] #7 `geekity settings list`, `get` and `set` work as decision-53 section 10 describes, including the printed source and the stored value for an overridden setting and `(set)` for a secret
- [x] #8 `geekity maintenance on|off|status` and `geekity dev-mode on|off|status` keep their names and printed sentences, are implemented over the registry, and cli-maintenance.test.ts and cli-dev-mode.test.ts pass
- [x] #9 maintenance.ts enterMaintenance, leaveMaintenance, readMaintenance and MaintenanceWindow, dev-mode.ts enterDevMode, leaveDevMode and devModeOn, and the direct enterDevMode call in cms/boot.ts are deleted; holdOutbound reads the registry; the renderer takes dev mode as an input rather than reading it
- [x] #10 settings-boundary.test.ts fails when a file under settings/ imports from admin/, web/, cms/, plugins/ or cli.ts, is shown to fail on a deliberately added import before it is removed, and settings/ is a layer below site/ in layer-boundary.test.ts
- [x] #11 docs/public-site.md, docs/deploying.md and a new section in docs/configuration.md or docs/settings.md describe the admin switches and `geekity settings`; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Types first: packages/cms/src/settings/types.ts holds SettingType, Parsed, DataClass, SettingDeclaration, SettingChange, NamespaceDeclaration, ValueSource, Resolved, SettingRef, SetResult, SettingsRegistry, SettingsDirs as decision-53 section 3 sketches them. settings/kinds.ts holds the boolean and instant-or-empty SettingTypes; settings/declare.ts declareNamespace; settings/names.ts the key pattern, CORE_NAMESPACES, upperSnake and pluginEnvPrefix (moved from plugins/settings.ts).
2. settings/registry.ts createSettingsRegistry({ config, env }): resolve = env <PREFIX>__<KEY>, then override, then file (through the namespace's legacy reader), then default, with the source. Reads and writes go through the file's lock so a read after a set sees it. set checks every key (unknown, parse, override in effect, check) before writing anything, writes once, then runs change hooks. register refuses reserved namespaces and GEEKITY or core prefixes.
3. settings/maintenance.ts (MAINTENANCE: on with override from config.maintenance, until) and settings/dev-mode.ts (DEV_MODE: on with env false and the jsonl hook; the record's append and readDevModeRecord move here).
4. Boundary: settings-boundary.test.ts modelled on sqlite-boundary.test.ts; settings/ layer below site/ in layer-boundary.test.ts; dev-mode.ts and maintenance.ts move to a layer above settings.
5. Callers: boot builds the registry and latches dev mode through set('dev_mode', on, 'boot'); Booted, Services, Cms and the request context carry settings; holdOutbound becomes async over the registry; createMaintenanceSwitch becomes a one-second memo over values(MAINTENANCE); a middleware reads dev_mode.on per request and hands it to the renderer as an input (as signedIn is) and to the listing fingerprint and admin banner. Delete enterMaintenance, leaveMaintenance, readMaintenance, MaintenanceWindow, enterDevMode, leaveDevMode, devModeOn.
6. Admin: Tools > Maintenance (new screen and template) and a switch on Tools > Dev mode, both refusing with the source sentence when overridden or latched.
7. CLI: geekity settings list|get|set (and --unset); maintenance and dev-mode commands as thin layers keeping their sentences; update the file assertions in cli-maintenance and cli-dev-mode tests to the new { on } shape.
8. Plugin registry refuses a reserved namespace or prefix beside prefixCollisions.
9. Docs: public-site.md, deploying.md, settings.md/configuration.md. Verify with pnpm build, test, typecheck, lint, format:check and a curl session against a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/settings/ (types.ts, names.ts, kinds.ts, declare.ts, registry.ts, maintenance.ts, dev-mode.ts). Choices where decision-53 was underspecified, each the simplest option consistent with it:
- override is { field, value(config) } rather than a bare function, so the registry can name the source: env GEEKITY_MAINTENANCE when the config field's variable is set (config.ts gains configVariables(field)), config <field> otherwise.
- onChange gets dirs on SettingChange (the dev_mode hook needs dataDir). check, fileKey and the folder storage kind are left out: wave 1 has no user for them.
- Reads and writes of one file go through its withFileLock, so boot's unawaited set('dev_mode', on, 'boot') is seen by any later read. A test (read after an unawaited write) fails when reads bypass the lock.
- A namespace with a legacy reader is written whole (every declared key; an unset key stores its default). Without this, geekity settings set maintenance.until X on a fresh site wrote {until} and the presence-means-on legacy reader then read maintenance as on. Caught by cli-settings.test.ts.
- A file that is there but cannot be read (EACCES) reaches the legacy reader as undefined, so dev mode and maintenance stay on, as decision-35 requires; a missing file is {}.
- The dev-mode record (append, readDevModeRecord, entry types) moved into settings/dev-mode.ts beside the hook that writes it; dev-mode.ts keeps holdOutbound (async, reads the registry) and maintenance.ts keeps the one-second memo over values(MAINTENANCE). Both moved to a new layer 'runtime flags' above settings/ in layer-boundary.test.ts, because holdOutbound imports settings/ and settings/ imports the record.
- Dev mode reaches the renderer as a request input: a middleware in cms/app.ts reads dev_mode.on once per request into c.var.devMode (listing fingerprint, admin banner) and runs the request under drawnInDevMode, the AsyncLocalStorage pattern signedIn already uses.
- holdOutbound(settings, config, effect): settings threaded through delivery, relays, inbox (FederationContextData.settings), webmentions, mail, notify, IndexNow. The feed-ping hold moved inside the ping queue so notifier.settled() covers it. Cms gains settings.
- pluginEnvPrefix/upperSnake moved to settings/names.ts; the plugin registry refuses a reserved namespace or prefix beside prefixCollisions (test: site, @geekity/maintenance).
- geekity maintenance on now writes {on: true, until} and refuses with the registry sentence when GEEKITY_MAINTENANCE overrides on; off while overridden exits 1 with today's sentence (Maintenance mode is still on. GEEKITY_MAINTENANCE or the maintenance setting keeps it on ...) instead of deleting the file and exiting 0. cli-maintenance and cli-dev-mode tests keep their sentence assertions; their file assertions changed from presence to { on } shape.
- web/reply-context.test.ts stub held only the last request to the slow target; the extra await before a webmention send reordered two fetches to the same URL, so the stub now answers every waiter.
Evidence: settings-boundary.test.ts failed on a deliberately added import of ../admin/documents.ts in settings/kinds.ts ('settings/kinds.ts:35 imports ../admin/documents.ts') and passed once it was removed. Curl session against a scratch site (geekity serve on :4386): Tools > Maintenance on with until -> / answered 503 with Retry-After Tue, 13 Oct 2026 23:00:00 GMT, /healthz maintenance true; off -> / 200. Tools > Dev mode on -> admin banner; off -> dev-mode.jsonl has on/off by admin and the screen lists Went live / the admin switch. Restarted with GEEKITY_MAINTENANCE=on GEEKITY_DEV_MODE=true: public 503; maintenance page shows and the POST answers 400 with 'maintenance.on is set by GEEKITY_MAINTENANCE and cannot be changed here.'; dev mode page shows and the POST answers 400 with 'GEEKITY_DEV_MODE or the devMode setting still asks for dev mode. ...'; boot latched dev mode with by config. Server stopped.

Validation: pnpm build, pnpm typecheck, pnpm lint (doc links included) and pnpm format:check pass. packages/cms tests: 5833 pass, 0 fail. Plugin packages (48, 22, 31, 106) and apps/demo (32) pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the settings registry (packages/cms/src/settings/) from decision-53: typed declarations and refs, async get/resolve/values/set/list/register/unregister, env then config override then file then default with the source reported, whole-call refusal, change hooks, reserved core namespaces and prefixes. Maintenance and dev mode are its first users: legacy presence-is-on files read as on, boot latches dev mode through set, holdOutbound and the maintenance gate read the registry, the renderer takes dev mode as a request input, and the dev_mode.on hook records on and off with who did it. Added Tools > Maintenance and a switch on Tools > Dev mode that show and refuse overrides and the latch, geekity settings list/get/set, and reimplemented geekity maintenance and dev-mode over it. Deleted enterMaintenance, leaveMaintenance, readMaintenance, MaintenanceWindow, enterDevMode, leaveDevMode, devModeOn and boot's direct enterDevMode call. Added settings-boundary.test.ts (shown failing on a planted admin import) and a settings layer below site/. Docs: public-site.md, deploying.md, settings.md (Runtime settings), cli.md, configuration.md. Verified with the full test suites, build, typecheck, lint, format check and a curl session against a running site (503 and recovery, switches, override and latch refusals).
<!-- SECTION:FINAL_SUMMARY:END -->
