---
id: TASK-178
title: MCP audit log and rate limits
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:14
updated_date: '2026-10-25T14:51:00Z'
labels:
  - mcp
  - security
milestone: m-26
dependencies:
  - TASK-172
priority: high
type: feature
ordinal: 202800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
specification.website asks for rate limits and audit logs on MCP endpoints. Record every tool call (time, user, client, tool, a redacted summary of arguments, outcome) where the owner can read it, show recent activity per client on the connected apps screen, and limit calls per token so a looping agent cannot hammer the site or the fediverse.

Build on what exists rather than beside it. The IndieAuth activity log (`web/indieauth-activity-log.ts`, shown by `admin/app-activity.ts`) already records IndieAuth and Micropub requests per client, redacted, bounded and under data/; MCP calls belong in the same record or a sibling with the same shape and retention. The only limiter today is the in-memory per-key throttle in `web/throttle.ts`; a per-token limiter follows its pattern. Both hook into the TASK-172 tool registry, so every core and plugin tool is covered without opting in. This lands before any tool that reads private data or writes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every MCP tool call, core or plugin, is recorded with time, user, client, tool, redacted arguments and outcome, without the tool doing anything
- [x] #2 The connected apps screen shows each client recent MCP calls alongside its IndieAuth and Micropub activity
- [x] #3 Calls beyond a per-token rate limit get an MCP error with a retry hint, proven by tests
- [x] #4 Audit records are pruned after a documented retention period
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a ToolCallRecord { tool, args, call, outcome } the registry hands to its record guard for every tools/call, where outcome is the answer (ran / insufficient-scope / unknown-tool / rate-limited) or crashed with the reason. createToolRegistry(tools, guards) takes ToolGuards { limit, record }, so every core and plugin tool passes the limit and the record without opting in.

1. tools.ts: call() takes the per-token limit first, then name, scope, run; catches a throw and answers a tool error; hands every outcome to guards.record.
2. mcp/call-limit.ts: fixed-window per-key limit after createRequestLimit, saying whether a refusal is the first in its window, so a hammering client is recorded once per window.
3. protocol.ts: rate-limited maps to a JSON-RPC error (code -32002) with data.retryAfter and the wait in the message, HTTP 200.
4. indieauth-activity-log.ts: endpoint 'mcp' entries in a sibling file data/mcp-activity.json (declared in data-files.ts), same entry shape and 14-day retention, 500-entry bound. readActivityLog merges both newest first; activityLogSettled waits on both. Entries gain connection (token id) and tokenName. recordMcpCall takes plain facts (web/ may not import mcp/); mcp/audit.ts maps a ToolCallRecord to them.
5. endpoint.ts: registry built per mount on first request with the limit (60 calls a minute per token) and the audit record.
6. App activity lists MCP calls with the others; Connected apps shows each connection's five latest entries linking to the full entry.
7. docs/mcp.md (record, rate limit), indieweb-sign-in.md, personal-data.md, content.md. plugin-wordpress data census drives an MCP call so the new data file has a writer.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- Registry: createToolRegistry(tools, guards). Order is limit, unknown tool, scope, run. A thrown tool becomes a tool error (isError) telling the client to ask the owner; the reason goes to the record only. Rate-limited answers carry retryAfter.
- Rate limit: 60 tool calls per 60 s per token id, in memory (restart clears it). Answer is a JSON-RPC error -32002 with data.retryAfter at HTTP 200, so SDK clients surface it as an McpError the model reads rather than a transport failure. initialize/tools/list/ping are not limited.
- Only the first refused call in a window is recorded, so a looping client cannot turn the record into a disk write per call. Documented.
- Record: sibling file data/mcp-activity.json (REBUILDABLE, 0600), same ActivityEntry shape with endpoint 'mcp', action = tool, method 'tools/call', status 200 (403 for scope), error codes tool_error / tool_failed / insufficient_scope / unknown_tool / rate_limited. Arguments go through the same field() redaction and 100-char cut as Micropub fields. Bound 500 entries, 14 days, pruned on each write and filtered on read.
- Micropub entries now also carry connection and tokenName, so a hand-made token is named on App activity instead of Unknown.
- Layering: web/ must not import mcp/ (layer-boundary test), so web exposes recordMcpCall(plain facts) and mcp/audit.ts maps the registry record onto it.
- Verified: full gate (pnpm build, test 7571 cms + all packages, test:11ty, typecheck, lint, format:check) green. Live: served a scratch site on :3178 with the built CLI, made an MCP token, curl'd whoami 62 times: calls 1-60 answered, 61 and 62 got -32002 with retryAfter 60; mcp-activity.json held 61 entries (one rate_limited), mode 600, password argument redacted (not in file). Signed in by curl: Connected apps listed MCP whoami entries with a Refused badge, App activity listed 61 MCP rows. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every MCP tool call now passes a per-token rate limit and lands in an audit record, enforced in the tool registry so no core or future plugin tool can skip either.

What changed: createToolRegistry takes guards (limit, record). Calls over 60 a minute per token get a JSON-RPC error -32002 with data.retryAfter and the wait in the message. A tool that throws answers a tool error instead of an HTTP 500. Each call is recorded in data/mcp-activity.json (same entry shape as the IndieAuth/Micropub log, 14-day retention, 500 entries, secrets redacted, values cut to 100 chars). App activity lists MCP calls alongside IndieAuth and Micropub requests; Connected apps shows each connection's five latest entries. Docs: docs/mcp.md gains The record of tool calls and Rate limit; personal-data, content and indieweb-sign-in name the new file.

Verification: tests for each AC (src/mcp/tools.test.ts, call-limit.test.ts, audit.test.ts), full gate green, and a live curl run against a served scratch site.

Risks: the limit is in memory per process; a restart resets it. Only the first refusal per window is recorded, by design.
<!-- SECTION:FINAL_SUMMARY:END -->
