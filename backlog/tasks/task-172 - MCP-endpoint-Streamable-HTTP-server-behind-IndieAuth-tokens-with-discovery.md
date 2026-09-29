---
id: TASK-172
title: 'MCP endpoint: Streamable HTTP server behind IndieAuth tokens, with discovery'
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
labels:
  - mcp
  - agents
milestone: m-26
dependencies:
  - TASK-161
references:
  - 'https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'
  - 'https://docs.claude.com/en/docs/claude-code/mcp'
priority: high
type: feature
ordinal: 196800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site owner wants to add their blog to Claude Code (and other MCP clients) so an agent can debug the site, above all its ActivityPub federation, and publish when asked. This task is the plumbing every later tool uses: an MCP server over Streamable HTTP at a stable path, authenticated with the access tokens M25 issues (bearer middleware from TASK-161, resource-bound per TASK-160, discovered through the protected resource metadata and WWW-Authenticate header from TASK-161). It exposes no tools of its own beyond a trivial whoami, so auth and transport are proven before anything reads private data. The scopes MCP tools need beyond Micropub's (at least one for reading operator data such as the inbox, and one for federation repair actions) are named and recorded as a decision here; they are shown on the consent screen and the connected apps screen like any other scope. Discovery follows specification.website: a server card at /.well-known/mcp/server-card.json and a Link rel=mcp header on the site root, plus a line in /llms.txt when TASK-149 has landed. The server card is a draft convention, so keep it small and easy to change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An MCP client connects over Streamable HTTP with a token from M25, lists tools, and calls whoami, which returns the token's user and scopes
- [ ] #2 A request with no token or a token issued for another resource gets 401 with the WWW-Authenticate header from TASK-161; a tool call lacking its scope returns an MCP error naming the missing scope
- [ ] #3 The MCP scopes are named, recorded as a decision, shown on the consent and connected apps screens, and grantable one by one
- [ ] #4 Claude Code connects with claude mcp add --transport http and completes the OAuth sign-in against a running site, or the notes record exactly what it needs that the site does not yet offer
- [ ] #5 /.well-known/mcp/server-card.json describes the server and a Link rel=mcp header on the site root points at it
- [ ] #6 The endpoint answers 503 in maintenance mode only if TASK-158's decision says the authorization flow does; the choice is consistent and tested
<!-- AC:END -->
