---
id: TASK-281
title: >-
  Plugin registry with dependencies and a Plugins screen; the WordPress switch
  becomes enabling the wordpress plugin
status: To Do
assignee: []
created_date: '2026-10-06 12:08'
updated_date: '2026-10-06 12:31'
labels:
  - plugins
milestone: m-30
dependencies: []
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/admin/settings.ts
  - packages/cms/src/admin/menu.ts
priority: high
type: feature
ordinal: 237800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Foundation of M31 (decision-33). Core gains a plugin definition (name, label, description, requires, register(host), optional start/stop) and a registry that registers every installed plugin at boot in dependency order and routes requests to its contributions only while it is enabled. The enabled set is the `plugins` key in `content/_data/site.json`, read per request, so enabling and disabling need no restart (Docker operators cannot restart from the admin). Built hand in hand with its first consumer: a `wordpress` plugin under `packages/cms/plugins/wordpress/` whose enabled state replaces the `wordpressActivityPub` setting that `wordPressGate` (src/federation/mount.ts) reads today. Moving the rest of the WordPress code is the next task; here the gate only changes which setting it reads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin is declared with name, label, description, requires and register(host); names are unique lower-case slugs and a duplicate name refuses to boot
- [ ] #2 register runs for every installed plugin at boot, dependencies before dependents; start runs for enabled plugins at boot and on enable, stop on disable and in close()
- [ ] #3 An installed plugin with a missing dependency or in a dependency cycle is marked unavailable with the reason, and the site still boots
- [ ] #4 Admin > Plugins lists every installed plugin with its label, description, dependencies, state (enabled, disabled, unavailable with reason) and whether it is first- or third-party
- [ ] #5 Enabling a plugin whose dependencies are disabled offers to enable them too; disabling a plugin that enabled plugins require is refused and the refusal names them
- [ ] #6 Enable and disable take effect on the next request without a restart; a disabled plugin contributes nothing to any response
- [ ] #7 At boot, an existing site.json with `wordpressActivityPub: true` becomes `plugins.wordpress` enabled and the old key is removed; the migration is idempotent and a site without the key is untouched
- [ ] #8 The WordPress paths under /wp-json/activitypub/1.0/ answer exactly as before when the wordpress plugin is enabled and 404 when it is not, proven by the existing wordpress.test.ts retargeted to the plugin state
- [ ] #9 doc-1 drops plugins from its out-of-scope list and gains a Plugins section describing the registry, dependencies and enabled state
- [ ] #10 Booting with every first-party plugin disabled loads none of their npm dependencies, proven by a test that records module resolution at boot; a first-party plugin imports its dependencies with await import() where it uses them
<!-- AC:END -->
