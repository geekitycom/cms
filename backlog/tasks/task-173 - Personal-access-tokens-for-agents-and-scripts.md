---
id: TASK-173
title: >-
  Personal access tokens for MCP: choose the resource a created token is bound
  to
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-10-23 16:55'
labels:
  - mcp
  - admin
  - security
milestone: m-26
dependencies:
  - TASK-172
references:
  - 'https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/'
priority: medium
type: feature
ordinal: 197800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Personal access tokens already exist: the connected apps screen (`admin/connected-apps.ts`) mints a named token with chosen scopes and a 7, 30, 90 or 365 day expiry (default 30), shown once and stored only as a hash, listed and revocable like an app. Some clients cannot run an OAuth flow, or the owner simply wants to paste a token: `claude mcp add --header 'Authorization: Bearer ...'` works with any MCP server.

What is missing is the resource. Created tokens are hard-bound to the base URL (`resource: baseUrl`), and the MCP endpoint (TASK-172) only takes tokens bound to `{base}/_geekity/mcp`. The form needs a resource choice, Micropub or MCP, and the MCP scopes must be offered when MCP is chosen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Creating a token on the connected apps screen asks for its resource (Micropub or MCP) and offers the scopes that resource takes
- [ ] #2 A token created for MCP works on /_geekity/mcp and is refused by Micropub, and a token created for Micropub is refused by MCP, proven by tests
- [ ] #3 The connected apps list shows which resource each created token is for
- [ ] #4 The docs show how to add the site to Claude Code with a personal token
<!-- AC:END -->
