---
id: TASK-173
title: Personal access tokens for agents and scripts
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
labels:
  - mcp
  - admin
  - security
milestone: m-26
dependencies:
  - TASK-162
references:
  - 'https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/'
priority: medium
type: feature
ordinal: 197800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some clients cannot run an OAuth flow, or the owner simply wants to paste a token: claude mcp add --header 'Authorization: Bearer ...' works with any MCP server. Let a user mint a token on the connected apps screen (TASK-162) with a name, chosen scopes, a resource (MCP or Micropub) and an expiry, shown once and stored only as a hash like any other token (TASK-160). specification.website warns against long-lived API keys, so expiry is required, with a sensible default and maximum, and a personal token is revocable and listed like an app.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A signed-in user creates a token with a name, scopes, resource and expiry; the token is shown once and only its hash is stored
- [ ] #2 The token works as a bearer token for exactly the chosen resource and scopes, and stops working at expiry or on revoke
- [ ] #3 Tokens without an expiry cannot be created; the default and maximum lifetimes are documented
- [ ] #4 README shows how to add the site to Claude Code with a personal token
<!-- AC:END -->
