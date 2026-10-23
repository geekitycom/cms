---
id: TASK-172
title: 'MCP endpoint: Streamable HTTP server behind IndieAuth tokens, with discovery'
status: To Do
assignee: []
created_date: '2026-09-29 02:13'
updated_date: '2026-10-23 16:55'
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
  - 'https://www.rfc-editor.org/rfc/rfc9728'
  - 'https://www.rfc-editor.org/rfc/rfc8707'
priority: high
type: feature
ordinal: 196800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site owner wants to add their blog to Claude Code (and other MCP clients) so an agent can debug the site, above all its ActivityPub federation, and publish when asked. This task is the plumbing every later tool uses: an MCP server over Streamable HTTP at `/_geekity/mcp`, behind the bearer tokens the IndieAuth server already issues (`requireBearer` in `web/indieauth-bearer.ts`).

The endpoint is its own protected resource, `{base}/_geekity/mcp`, with `acceptsUnbound: false` as decision-24 and the `Audience` comment in `indieauth/tokens.ts` already expect. MCP clients send the server URL as the RFC 8707 resource, so the endpoint takes only tokens bound to that resource, and Micropub tokens (bound to the base URL or unbound) are refused. Per decision-23 and RFC 9728 that needs a second document at `/.well-known/oauth-protected-resource/_geekity/mcp`, and refusals from MCP routes point `resource_metadata` at it.

Tools are not ad hoc route handlers. Core keeps one tool registry: each tool declares a name, an input schema, an output schema, MCP annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) and the one scope it needs. The endpoint checks the scope before a tool runs, so later tasks get scope checks, the audit log and rate limits (TASK-178) and plugin tools (the plugin tool hook task) in one place. This task registers only a trivial whoami.

The MCP scopes beyond Micropub's (at least one for reading operator data such as the inbox, and one for federation repair) are named and recorded as a decision. The scope set is fixed by core: plugins choose among these scopes and cannot mint their own, so the consent screen stays a readable, fixed list. The scopes are shown on the consent screen and the connected apps screen like any other.

OAuth for Claude Code: the authorization server has no dynamic client registration but advertises Client ID Metadata Documents and requires S256 PKCE. Check which the current MCP authorization spec and Claude Code prefer, and record what was needed.

Discovery follows specification.website: a server card at `/.well-known/mcp/server-card.json`, a `Link: rel="mcp"` header on the site root beside the existing `llms.txt` link, and a line in the generated `/llms.txt` (TASK-149 is Done). The server card is a draft convention, so keep it small and easy to change.

Maintenance mode: TASK-158 made the authorization and token endpoints answer 503 (`web/maintenance.ts`), so the MCP endpoint does too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An MCP client connects over Streamable HTTP at /_geekity/mcp with a token bound to {base}/_geekity/mcp, lists tools, and calls whoami, which returns the token user, client and scopes
- [ ] #2 A request with no token, an unbound token, or a token bound to another resource (including a Micropub token) gets 401 with WWW-Authenticate naming /.well-known/oauth-protected-resource/_geekity/mcp, which is served and names the MCP resource
- [ ] #3 A tool call lacking its declared scope returns an MCP error naming the missing scope, enforced by the registry rather than by each tool
- [ ] #4 Tools are declared in one registry with name, input schema, output schema, annotations and scope; tools/list is generated from it
- [ ] #5 The MCP scopes are named, recorded as a decision (including that plugins cannot add scopes), shown on the consent and connected apps screens, and grantable one by one
- [ ] #6 Claude Code connects with claude mcp add --transport http and completes the OAuth sign-in against a running site, or the notes record exactly what it needs that the site does not yet offer
- [ ] #7 /.well-known/mcp/server-card.json describes the server, the site root sends a Link rel=mcp header pointing at it, and the generated /llms.txt names the endpoint
- [ ] #8 The endpoint answers 503 in maintenance mode, like the authorization and token endpoints, proven by a test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rescoped 2026-10-23. Settled: the MCP resource is {base}/_geekity/mcp (not the base URL), so it follows the MCP spec on audience and Micropub tokens cannot call MCP tools. Check whether the MCP spec revision after 2025-06-18 changes the authorization references (Client ID Metadata Documents vs dynamic registration) and update them. Personal tokens already exist (connected apps, "created" kind); TASK-173 adds the resource choice they need.
<!-- SECTION:NOTES:END -->
