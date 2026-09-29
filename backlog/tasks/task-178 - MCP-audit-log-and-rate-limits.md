---
id: TASK-178
title: MCP audit log and rate limits
status: To Do
assignee: []
created_date: '2026-09-29 02:14'
labels:
  - mcp
  - security
milestone: m-26
dependencies:
  - TASK-172
priority: medium
type: feature
ordinal: 202800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
specification.website asks for rate limits and audit logs on MCP endpoints. Record every tool call (time, user, client, tool, a redacted summary of arguments, outcome) where the owner can read it, show recent activity per client on the connected apps screen, and limit calls per token so a looping agent cannot hammer the site or the fediverse. Audit records are operational, so they live under data/ with a retention limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every MCP tool call is recorded with time, user, client, tool, redacted arguments and outcome
- [ ] #2 The connected apps screen shows each client's recent calls
- [ ] #3 Calls beyond a per-token rate limit get an MCP error with a retry hint, proven by tests
- [ ] #4 Audit records are pruned after a documented retention period
<!-- AC:END -->
