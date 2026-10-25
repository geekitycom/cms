---
id: TASK-503
title: Plugin MCP tool hook, with a first tool in plugin-umami
status: Done
assignee:
  - '@claude'
created_date: 2026-10-23 16:55
updated_date: '2026-10-25T15:10:00Z'
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
- [x] #1 A plugin registers an MCP tool with name, input schema, output schema, annotations and a core scope, and an MCP client lists and calls it under a plugin-prefixed name
- [x] #2 A disabled plugin tools are absent from tools/list and refused if called, and come back when it is enabled, without a restart
- [x] #3 A plugin tool call without its scope is refused, is recorded in the audit log and counts toward the rate limit, with no code in the plugin, proven by tests
- [x] #4 A plugin cannot declare a scope outside the core set; registering one fails at boot with a clear error
- [x] #5 HOST_API_VERSION is bumped and docs/ describe the hook with an example
- [x] #6 plugin-umami exposes a read-only post stats tool annotated readOnlyHint true and openWorldHint true, tested against a stubbed Umami
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move mcp/schema.ts to util/json-schema.ts so the plugin API (ports layer) can re-export the schema types; move MCP_SCOPES/McpScope and the tool annotation/outcome types into plugin.ts, which core MCP code imports.
2. plugin.ts: PluginTool<I,O>, PluginToolContext (user, client, signal, site, timezone), host.tool(); HOST_API_VERSION 3 -> 4.
3. plugins/registry.ts: host.tool validates id, uniqueness and scope (outside MCP_SCOPES fails register, plugin unavailable with the reason); MCP name = lower-cased env prefix + '__' + id with '-' as '_', unique by the existing env-prefix rule and never equal to a core name (core names carry no '__').
4. mcp/endpoint.ts: guards built once per mount; tool list built per request from CORE_TOOLS + tools of c.var.activePlugins, so enable/disable follow without restart; server card lists the same set.
5. Tests first: plugin tool listed/called under prefixed name; disabled absent and refused, back on enable; missing scope refused, audited, rate limited; bad scope refused at boot.
6. plugin-umami: post-stats tool (inspect, readOnlyHint, openWorldHint) over stats + referrers filtered by path, tested with the fake Umami; hostApi 4.
7. Docs: docs/plugins.md host.tool section with example, docs/mcp.md plugin tools, plugin-umami README.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Layering: the JSON Schema subset moved from mcp/schema.ts to util/json-schema.ts, and MCP_SCOPES/McpScope plus McpToolAnnotations/McpToolOutcome moved into plugin.ts (ports layer), so the plugin API can publish them; indieauth, admin, web and mcp import them from there. The compile-time tie between MCP_SCOPES and Scope is token.scopes.includes(tool.scope) in mcp/tools.ts.

Naming: a plugin tool is <lower-cased env prefix>__<id with _ for ->, e.g. geekity_plugin_umami__post_stats. Uniqueness across plugins rides on the existing env-prefix collision rule; no core tool name holds __ (tested via the server card). Only [a-z0-9_], which every MCP client accepts.

Live set: guards (rate limit + audit) are built once per mount; the tool registry is built per request from CORE_TOOLS plus the tools of c.var.activePlugins, so enable/disable take effect on the next request. The server card lists the same set. SERVER_CAPABILITIES keeps listChanged false: the stateless endpoint has no stream to notify on.

Tool context: user, client, clientName, signal, site, timezone. use() is reached through host.use in run, as widgets do, rather than duplicated on the context.

Verification: pnpm build, pnpm test (cms 7583 pass, plugin-umami 116, demo 32 after updating its host API version assertion), pnpm test:11ty, typecheck, lint, format:check all pass. Live: served a site with plugin-umami on 127.0.0.1:4719 and curled /_geekity/mcp: tools/list and the server card list geekity_plugin_umami__post_stats; a profile-only token gets 403 insufficient_scope naming inspect; after setting enabled:false in site.json the tool left list and card and a call answered -32602; after re-enabling it came back, no restart.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugins can now offer MCP tools. host.tool() (HOST_API_VERSION 4) declares id, title, description, one scope from core's MCP_SCOPES, annotations, input and output schemas and run(args, context). Core names the tool after the plugin (acme_plugin_x__tool_id), lists and serves it only while the plugin is active, validates arguments, checks the scope, counts the call toward the per-token limit and records it, with no plugin code. A scope outside MCP_SCOPES, a bad or duplicate id fails the plugin's register at boot with a clear reason on the Plugins screen. @geekity/plugin-umami gains geekity_plugin_umami__post_stats (inspect; readOnlyHint, openWorldHint true): views, visitors, visits, the previous span and top referrers for one path, with the client's metrics call gaining a path filter. Docs: docs/plugins.md (MCP tools section with example, version 4), docs/mcp.md (plugin tools, server card), plugin-umami README. Risk: plugin-umami now targets host API 4, so it needs a core release that includes this change.
<!-- SECTION:FINAL_SUMMARY:END -->
