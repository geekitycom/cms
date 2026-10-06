---
id: TASK-281
title: >-
  Plugin registry with dependencies, the Plugins screen and the
  @geekity/cms/plugin export
status: To Do
assignee: []
created_date: '2026-10-06 12:08'
updated_date: '2026-10-06 12:41'
labels:
  - plugins
milestone: m-30
dependencies: []
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - packages/cms/src/index.ts
  - packages/cms/src/admin/settings.ts
  - packages/cms/src/admin/menu.ts
  - packages/cms/package.json
priority: high
type: feature
ordinal: 237800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Foundation of M31 (decision-33). Core gains a plugin definition (name, label, description, requires, register(host), optional start/stop) and a registry that registers every installed plugin at boot in dependency order and routes requests to its contributions only while it is enabled. The enabled set is the `plugins` key in `content/_data/site.json`, read per request, so enabling and disabling need no restart. Plugins are separate npm packages (decision-33), so this task also opens the boundary they import: a `@geekity/cms/plugin` subpath export with the plugin and host types and definePlugin, and `plugins` on the site config for sites that run their own server.ts. The first consumer is an example plugin in apps/demo, registered through the config, that contributes one public route and declares a dependency on a second example plugin.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin is declared with name, label, description, requires and register(host); names are unique lower-case slugs and two plugins with one name refuse to boot with both sources named
- [ ] #2 register runs for every installed plugin at boot, dependencies before dependents; start runs for enabled plugins at boot and on enable, stop on disable and in close()
- [ ] #3 An installed plugin with a missing dependency or in a dependency cycle is marked unavailable with the reason, and the site still boots
- [ ] #4 Admin > Plugins lists every installed plugin with its label, description, package and version, where it came from, its dependencies and its state (enabled, disabled, unavailable with reason)
- [ ] #5 Enabling a plugin whose dependencies are disabled offers to enable them too; disabling a plugin that enabled plugins require is refused and the refusal names them
- [ ] #6 Enable and disable take effect on the next request without a restart; a disabled plugin contributes nothing to any response, proven with the demo example route
- [ ] #7 `@geekity/cms/plugin` exports the plugin and host types and definePlugin; the demo example plugins import nothing else from core, and a test over the packed tarball shows the export resolves
- [ ] #8 The host API carries a version number that a plugin can read and declare against
- [ ] #9 doc-1 drops plugins from its out-of-scope list and gains a Plugins section describing the registry, dependencies, enabled state and the package boundary
<!-- AC:END -->
