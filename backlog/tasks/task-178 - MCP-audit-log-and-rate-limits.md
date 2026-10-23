---
id: TASK-178
title: MCP audit log and rate limits
status: To Do
assignee: []
created_date: '2026-09-29 02:14'
updated_date: '2026-10-23 16:55'
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
- [ ] #1 Every MCP tool call, core or plugin, is recorded with time, user, client, tool, redacted arguments and outcome, without the tool doing anything
- [ ] #2 The connected apps screen shows each client recent MCP calls alongside its IndieAuth and Micropub activity
- [ ] #3 Calls beyond a per-token rate limit get an MCP error with a retry hint, proven by tests
- [ ] #4 Audit records are pruned after a documented retention period
<!-- AC:END -->
