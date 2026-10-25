---
id: TASK-172
title: 'MCP endpoint: Streamable HTTP server behind IndieAuth tokens, with discovery'
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T14:14:00Z'
labels:
  - mcp
  - agents
milestone: m-26
dependencies:
  - TASK-161
references:
  - https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/
  - https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
  - https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
  - https://docs.claude.com/en/docs/claude-code/mcp
  - https://www.rfc-editor.org/rfc/rfc9728
  - https://www.rfc-editor.org/rfc/rfc8707
  - https://www.rfc-editor.org/rfc/rfc8252#section-7.3
documentation:
  - docs/mcp.md
  - >-
    backlog/decisions/decision-64 -
    MCP-scopes-are-inspect-repair-and-publish-fixed-by-core-plugins-choose-among-them.md
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
- [x] #1 An MCP client connects over Streamable HTTP at /_geekity/mcp with a token bound to {base}/_geekity/mcp, lists tools, and calls whoami, which returns the token user, client and scopes
- [x] #2 A request with no token, an unbound token, or a token bound to another resource (including a Micropub token) gets 401 with WWW-Authenticate naming /.well-known/oauth-protected-resource/_geekity/mcp, which is served and names the MCP resource
- [x] #3 A tool call lacking its declared scope returns an MCP error naming the missing scope, enforced by the registry rather than by each tool
- [x] #4 Tools are declared in one registry with name, input schema, output schema, annotations and scope; tools/list is generated from it
- [x] #5 The MCP scopes are named, recorded as a decision (including that plugins cannot add scopes), shown on the consent and connected apps screens, and grantable one by one
- [x] #6 Claude Code connects with claude mcp add --transport http and completes the OAuth sign-in against a running site, or the notes record exactly what it needs that the site does not yet offer
- [x] #7 /.well-known/mcp/server-card.json describes the server, the site root sends a Link rel=mcp header pointing at it, and the generated /llms.txt names the endpoint
- [x] #8 The endpoint answers 503 in maintenance mode, like the authorization and token endpoints, proven by a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scopes: add publish, inspect and repair to SCOPES with consent/connected-apps labels; MCP_SCOPES is the set the MCP resource advertises. Record decision (core-fixed scope set, plugins pick from it). Created-token form keeps offering only the site-resource scopes until TASK-173 adds the resource choice.
2. Data shape: src/mcp/schema.ts (JSON Schema subset + FromSchema type + validate), src/mcp/tools.ts (defineTool -> McpTool: name, title, description, inputSchema, outputSchema, annotations, scope, run; createToolRegistry with list() and call() that checks the scope before the tool runs and validates input), src/mcp/whoami.ts, src/mcp/protocol.ts (JSON-RPC: initialize, ping, tools/list, tools/call, notifications -> 202).
3. HTTP: web/mcp-endpoint.ts mounts POST /_geekity/mcp behind requireBearer with audience {base}/_geekity/mcp, acceptsUnbound false; GET/DELETE 405; Origin check 403; unsupported MCP-Protocol-Version 400; insufficient scope -> 403 + WWW-Authenticate insufficient_scope + JSON-RPC error naming the scope. Guard gains resourceMetadataPath so refusals point at /.well-known/oauth-protected-resource/_geekity/mcp, which is served.
4. Discovery: /.well-known/mcp/server-card.json, Link rel=mcp on /, a line in generated /llms.txt.
5. Tests first for each AC (mcp-endpoint.test.ts, registry unit tests, discovery, maintenance 503). Docs: docs/mcp.md + sign-in scopes.
6. Try Claude Code against a local site for AC#6; record findings.

7. Found while running Claude Code: the consent screen compared ports on loopback redirects. It now accepts any port on an http loopback redirect the client lists (RFC 8252 section 7.3).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rescoped 2026-10-23. Settled: the MCP resource is {base}/_geekity/mcp (not the base URL), so it follows the MCP spec on audience and Micropub tokens cannot call MCP tools. Check whether the MCP spec revision after 2025-06-18 changes the authorization references (Client ID Metadata Documents vs dynamic registration) and update them. Personal tokens already exist (connected apps, "created" kind); TASK-173 adds the resource choice they need.

Built 2026-10-25.

Shape: src/mcp/schema.ts is a JSON Schema subset with FromSchema (a tool's run gets the type its schema promises) and problemsWith (argument check). src/mcp/tools.ts holds defineTool (checks arguments, then runs), McpTool, and createToolRegistry, whose call() checks the tool's one declared scope before run. Audit log, rate limits (TASK-178) and plugin tools (TASK-503) wrap or extend registry.call/list. src/mcp/protocol.ts is pure JSON-RPC: initialize, ping, tools/list, tools/call; notifications and client responses come back as 202. src/mcp/endpoint.ts is the Hono transport, stateless, with JSON responses only: GET and DELETE answer 405, a foreign Origin gets 403, an unsupported MCP-Protocol-Version gets 400. It also serves the server card. The MCP resource metadata, MCP_PATH and MCP_SERVER_CARD_PATH live in web/indieauth-discovery.ts so web/ (llms.txt, the home Link) can name them.

Auth: the bearer Guard takes resourceMetadataPath, so MCP refusals name /.well-known/oauth-protected-resource/_geekity/mcp (RFC 9728 path insertion). Missing scope gets 403 + WWW-Authenticate error=insufficient_scope with scope = the token's scopes plus the missing one (MCP 2025-11-25 'Scope Challenge Handling'), and the body is a JSON-RPC error (-32001) naming the scope.

Scopes (decision-64): publish, inspect, repair added to SCOPES. MCP_SCOPES = profile create update media publish inspect repair (what the MCP metadata lists). SITE_SCOPES = the old six, used by the site's resource metadata and by the created-token form until TASK-173. whoami needs profile.

MCP spec check: 2025-11-25 makes Client ID Metadata Documents the SHOULD (DCR is a MAY, kept for backwards compatibility), requires S256 PKCE checked through code_challenge_methods_supported, and requires RFC 8707 resource on both the authorization and token requests. The site already offers all of that. References updated to 2025-11-25.

Claude Code 2.1.310, run against a local site (geekity serve on :4817, isolated CLAUDE_CONFIG_DIR, claude mcp add --transport http then claude mcp login --no-browser driven through a pty). It read the MCP resource metadata and /.well-known/oauth-authorization-server, then used CIMD with client_id https://claude.ai/oauth/claude-code-client-metadata, S256, resource=http://localhost:4817/_geekity/mcp and scope = every scope in scopes_supported. The first attempt was refused because Claude Code's metadata lists http://localhost/callback with no port and it returns to http://localhost:54007/callback. The fix: the consent screen no longer compares the port on http loopback redirects (RFC 8252 section 7.3), with a test. After that the consent showed all seven MCP scopes, approving profile+inspect issued a token bound to the MCP resource, and claude mcp list showed Connected. Claude Code first POSTs server/discover with MCP-Protocol-Version 2026-07-28, gets 400, and then falls back to initialize at 2025-11-25. A later spec revision exists that this server does not speak yet. whoami was not called from inside Claude Code: that needs a model session; the endpoint tests cover it.

Also: util/package-version.ts replaces two copies of the package.json read. The anonymous-pages golden gains the rel=mcp Link.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site now runs an MCP server at /_geekity/mcp. It uses Streamable HTTP, keeps no session and answers in JSON, and it takes only IndieAuth tokens bound to {base}/_geekity/mcp. Unbound tokens, Micropub tokens and tokens for other resources get 401, pointed at /.well-known/oauth-protected-resource/_geekity/mcp. Tools are defined once in a registry (src/mcp/tools.ts) with name, title, input and output schemas, all four annotations and one scope. tools/list is generated from it, arguments are checked against the input schema, and the scope is checked before the tool runs. A missing scope gets 403 with an insufficient_scope challenge and a JSON-RPC error naming the scope. The first tool is whoami (scope profile). decision-64 adds the inspect, repair and publish scopes, fixed by core, with plugins choosing among them. They show on the consent and connected apps screens. Discovery covers the server card at /.well-known/mcp/server-card.json, Link rel=mcp on the home page, and a line in the generated llms.txt. The endpoint answers 503 in maintenance mode.

Claude Code 2.1.310 connected to a local site and finished the OAuth sign-in after one fix: the consent screen now ignores the port on http loopback redirects (RFC 8252), because Claude Code's client metadata lists http://localhost/callback.

Verified with pnpm build, test (cms 7550 pass), test:11ty, typecheck, lint and format:check, plus curl and claude mcp login/list against the running site. Docs are in docs/mcp.md, with changes to indieweb-sign-in.md and public-site.md.

Follow-ups for later tasks: Claude Code tries MCP 2026-07-28 first and falls back. Tools are core-only until TASK-503. Created tokens stay bound to the site until TASK-173. A tool that throws becomes a 500, so TASK-178 may want to wrap that.
<!-- SECTION:FINAL_SUMMARY:END -->
