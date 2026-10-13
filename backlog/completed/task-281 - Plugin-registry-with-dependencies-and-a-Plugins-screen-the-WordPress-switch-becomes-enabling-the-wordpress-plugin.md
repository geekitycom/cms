---
id: TASK-281
title: >-
  Plugin registry with dependencies, the Plugins screen and the
  @geekity/cms/plugin export
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:08'
updated_date: '2026-10-08 14:21'
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
Foundation of M31 (decision-33). Core gains a plugin definition (name, label, description, requires, register(host), optional start/stop), named by its npm package name and a registry that registers every installed plugin at boot in dependency order and routes requests to its contributions only while it is enabled. The enabled set is the `plugins` key in `content/_data/site.json`, keyed by package name, read per request, so enabling and disabling need no restart. Plugins are separate npm packages (decision-33), so this task also opens the boundary they import: a `@geekity/cms/plugin` subpath export with the plugin and host types and definePlugin, and `plugins` on the site config for sites that run their own server.ts. The first consumer is an example plugin in apps/demo, registered through the config, that contributes one public route and declares a dependency on a second example plugin.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A plugin is declared with name, label, description, requires and register(host); the name is the npm package name (a hand-installed plugin declares a package-style one) and two plugins with one name refuse to boot with both sources named
- [x] #2 An installed plugin with a missing dependency or in a dependency cycle is marked unavailable with the reason, and the site still boots
- [x] #3 Admin > Plugins lists every installed plugin with its label, description, package and version, where it came from, its dependencies and its state (enabled, disabled, unavailable with reason)
- [x] #4 Enable and disable take effect on the next request without a restart; a disabled plugin contributes nothing to any response, proven with the demo example route
- [x] #5 `@geekity/cms/plugin` exports the plugin and host types and definePlugin; the demo example plugins import nothing else from core, and a test over the packed tarball shows the export resolves
- [x] #6 The host API carries a version number that a plugin can read and declare against
- [x] #7 doc-1 drops plugins from its out-of-scope list and gains a Plugins section describing the registry, dependencies, enabled state and the package boundary
- [x] #8 A plugin cannot be enabled until every plugin it requires is installed and enabled; its row names each missing or disabled plugin and the range it needs, with a link to enable one that is installed. Disabling a plugin that enabled plugins require is refused and the refusal names them
- [x] #9 register runs once for every installed plugin at boot in any order, and no plugin can reach another during register; start runs for enabled plugins after every register, dependencies before dependents, at boot and on enable, and stop runs in reverse on disable and in close()
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Boundary: packages/cms/src/plugin.ts is the @geekity/cms/plugin subpath export (package.json exports ./plugin). It holds HOST_API_VERSION, the Plugin and PluginHost types, the request-handler types and definePlugin (an identity function, so a bundle needs no runtime import of core). A Plugin is { name (npm package name), version, label, description, hostApi, requires?: Record<package name, semver range>, register(host), start?, stop? }.
2. Registry: packages/cms/src/plugins/registry.ts. createPluginRegistry takes installed plugins with their source. It throws when two share a name and names both sources. It marks a plugin unavailable, with the reason, when the name is not package-style, hostApi is newer than HOST_API_VERSION, register throws, a dependency is missing or unavailable, or the plugin sits in a dependency cycle. register runs once per plugin in install order, with a host scoped to that plugin and no way to reach another plugin. The registry computes a topological order once.
3. Enabled set: packages/cms/src/plugins/enabled.ts reads and writes the plugins key of content/_data/site.json ({ <name>: { enabled: true } }), keeping every other key. A plugin is active only when it is enabled, available and every plugin it requires is active.
4. Lifecycle: registry.reconcile(enabled) converges the started set on the active set. It stops dependents first and starts dependencies first, and it runs serialized. A middleware runs it on each request (only when plugins are installed), serve() runs it before listening, and close() stops everything in reverse.
5. Routes: host.get(path, handler) contributes a public GET route. It is mounted after the admin and before the public site, and when the plugin is not active it calls next(), so the route falls through as if it were absent.
6. Config: plugins?: readonly Plugin[] on GeekityConfig (source 'site config').
7. Admin > Plugins (/admin/plugins, a new menu section after Appearance) lists every installed plugin: label, description, package, version, source, dependencies with ranges and their state, and its own state (enabled, disabled, unavailable with reason). Enable and Disable are a POST behind the CSRF guard. Enable is refused while a requirement is missing or disabled, and each such requirement is named with its range and a link to its row. Disable is refused while enabled plugins require the plugin, and the refusal names them.
8. Demo: apps/demo/plugins/hello.ts (public route /plugin-hello/, which requires the second example) and apps/demo/plugins/greetings.ts. Both are registered in geekity.config.ts and import only @geekity/cms/plugin. An ESLint no-restricted-imports rule and a test enforce that.
9. Packed tarball: scripts/pack-install-smoke.sh imports @geekity/cms/plugin from the installed scratch site and type checks a file that uses its types.
10. doc-1: drop plugins from out of scope and add a Plugins section.
Tests first for each AC (tdd), then the code; verify with build/test/typecheck/lint/format:check and curl the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- Shape: Plugin is { name, version, label, description, hostApi, requires?: Record<package, semver range>, register(host), start?, stop? }. requires is a record rather than a list of names, so each row and refusal can name the range it needs (AC#8), and so the pairs match the peer dependencies that TASK-287 will compare against. The host API version is a plain integer: HOST_API_VERSION = 1 in core, read as host.apiVersion and declared as plugin.hostApi.
- The registry is created before the database opens, so a duplicate name throws without leaving a connection open. Unavailable reasons cover a name that is not a package name, a newer hostApi, a register that throws, a missing or unavailable dependency, and a cycle (Tarjan SCC).
- Enabled state is site.json plugins[<name>].enabled. Disabling writes enabled:false and keeps the entry, so TASK-283 settings can sit beside it. A plugin is active only when it is enabled, available and everything it requires is active. A hand edit that disables a dependency therefore stops the dependent too, and the screen shows it as 'Enabled, not running'.
- Lifecycle: registry.reconcile(enabled) runs serialized and is idempotent. It runs in a per-request middleware (skipped when nothing is installed), in serve() before listening, and after each Enable or Disable. close() stops everything, dependents first, and nothing starts again after that.
- Routes: host.get(path, handler) with a web-standard Request/Response context. Routes are mounted after the admin and before the public site, and an inactive plugin's route calls next(), so the 404 matches an absent path.
- Not done here, on purpose: semver satisfaction of requires ranges is not checked. Only presence, availability and enabled state are checked. Range checks belong to TASK-287 AC#8 (folder installs); npm checks peer ranges for npm installs.
- Lint: the geekity/plugin-boundary ESLint rule restricts apps/demo/plugins/** and packages/plugin-*/src/** to @geekity/cms/plugin. A probe file showed it rejects @geekity/cms and relative imports into packages/cms.
- Validation: pnpm build && pnpm test (core 4860 pass, demo 32 pass) && pnpm typecheck && pnpm lint && pnpm format:check, all exit 0. scripts/pack-install-smoke.sh passed locally; it imports @geekity/cms/plugin from the installed tarball and type checks plugin-check.ts against the published declarations. curl against the running demo, on scratch content and data, port 3477, stopped afterwards: /plugin-hello/ answered 404 while disabled, 200 with the greeting once both plugins were enabled in site.json, and 404 after greetings was disabled by hand. Admin Enable of greetings flashed 'Greetings is enabled.', and Disable was refused with 'Greetings was not disabled. Hello (@geekity-demo/plugin-hello) requires it; disable that first.'
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the plugin foundation of M31 (decision-33). The @geekity/cms/plugin subpath export holds HOST_API_VERSION, the Plugin and PluginHost types and definePlugin. A registry (src/plugins/registry.ts) registers every installed plugin at boot, refuses duplicate names naming both sources, and marks a plugin unavailable with the reason for a missing dependency, a dependency cycle, a newer hostApi or a failing register. The enabled set is the plugins key in site.json, read per request. Start and stop converge on that set, dependencies first, at serve, on enable and disable, on a hand edit, and in close(). Plugins contribute public GET routes through host.get, and those routes fall through while the plugin is inactive. Admin > Plugins lists each plugin's package, version, source, dependencies with ranges, and state, and enforces the enable and disable dependency rules. plugins is on GeekityConfig. The demo registers two example plugins, hello (/plugin-hello/) and greetings, which import only @geekity/cms/plugin, enforced by an ESLint rule and a test. The pack-install smoke resolves the export from the packed tarball. doc-1 and doc-5 are updated. Verified with the full build, test, typecheck, lint and format gate, the pack-install smoke script, and curl against the running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
