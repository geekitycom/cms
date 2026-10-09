---
id: TASK-306
title: 'Install, update and remove plugins from the Plugins screen'
status: To Do
assignee: []
created_date: '2026-10-09 01:56'
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
- [ ] #1 Admin > Plugins has an Add plugin form that takes a package name and optional version or range, and installs it into the plugins folder with the same verified install and checks as `geekity plugin add` (integrity hash, bundle and manifest, host API and ranges); the outcome and any missing or out-of-range requirements are shown on the screen
- [ ] #2 Each folder-installed plugin row has Update (when a newer compatible version exists, using TASK-305's upgrade logic) and Remove, and the screen has Update all; after any change the screen offers Reload, which loads it without a container restart
- [ ] #3 Install, update and remove ask for the current user's password and refuse without it; every request needs the session and CSRF token like other admin forms
- [ ] #4 `GEEKITY_PLUGIN_INSTALL=off` hides these controls and refuses the requests with a clear message; it is on when unset, and the README documents the switch and the risk (a plugin runs as the site with access to data/ and the plugin secrets)
- [ ] #5 Plugins passed in the site config (a site with its own server.ts) are shown as managed in code and get no install, update or remove controls
- [ ] #6 Each install, update and removal is recorded with who, when, the package and the versions, and the record is visible to the owner
- [ ] #7 Tests cover the form, the password check, the switch, update and remove against a local fake registry; the browser path is driven in Playwright; doc-5 Admin UI and the README are updated
<!-- AC:END -->
