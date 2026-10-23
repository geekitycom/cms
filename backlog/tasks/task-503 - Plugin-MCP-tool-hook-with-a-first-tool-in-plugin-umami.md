---
id: TASK-503
title: 'Plugin MCP tool hook, with a first tool in plugin-umami'
status: To Do
assignee: []
created_date: '2026-10-23 16:55'
labels:
  - mcp
  - plugins
milestone: m-26
dependencies:
  - TASK-172
  - TASK-178
documentation:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
priority: medium
type: feature
ordinal: 416800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-33 deferred this on purpose: "MCP tools from plugins wait for M27." Plugins can add routes, screens, settings, CLI commands, editor actions, page tags and dashboard widgets (`PluginHost` in `packages/cms/src/plugin.ts`), but nothing an MCP client can call. `host.command()` is the nearest thing and does not fit: it is text in, exit code out, with no schema and no core services on the command line.

Add a host method that registers a tool in the core MCP tool registry (TASK-172): a name, input and output schemas, MCP annotations, the one core scope it needs, and a run function handed the calling user and client, an abort signal, the site and `use()` for core and required plugin services. Core prefixes the name with the plugin, lists and serves the tool only while the plugin is enabled (as the registry already does for routes and widgets), checks the scope, and applies the audit log and rate limit (TASK-178), so a plugin cannot skip any of them. A plugin picks from the core scope set and cannot declare new scopes (recorded in TASK-172's decision). The new method bumps `HOST_API_VERSION`.

decision-33 adds no host API without a consumer, so this ships with one: `@geekity/plugin-umami` gains a read-only tool, for example views and referrers for a post over a period, built on the data its dashboard widgets already fetch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin registers an MCP tool with name, input schema, output schema, annotations and a core scope, and an MCP client lists and calls it under a plugin-prefixed name
- [ ] #2 A disabled plugin tools are absent from tools/list and refused if called, and come back when it is enabled, without a restart
- [ ] #3 A plugin tool call without its scope is refused, is recorded in the audit log and counts toward the rate limit, with no code in the plugin, proven by tests
- [ ] #4 A plugin cannot declare a scope outside the core set; registering one fails at boot with a clear error
- [ ] #5 HOST_API_VERSION is bumped and docs/ describe the hook with an example
- [ ] #6 plugin-umami exposes a read-only post stats tool annotated readOnlyHint true and openWorldHint true, tested against a stubbed Umami
<!-- AC:END -->
