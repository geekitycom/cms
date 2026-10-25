---
id: TASK-173
title: >-
  Personal access tokens for MCP: choose the resource a created token is bound
  to
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T14:30:00Z'
labels:
  - mcp
  - admin
  - security
milestone: m-26
dependencies:
  - TASK-172
references:
  - https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/
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
- [x] #1 Creating a token on the connected apps screen asks for its resource (Micropub or MCP) and offers the scopes that resource takes
- [x] #2 A token created for MCP works on /_geekity/mcp and is refused by Micropub, and a token created for Micropub is refused by MCP, proven by tests
- [x] #3 The connected apps list shows which resource each created token is for
- [x] #4 The docs show how to add the site to Claude Code with a personal token
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a TOKEN_RESOURCES table in admin/connected-apps.ts, one entry per resource a created token can be bound to: name (micropub | mcp), label, the scopes it takes (SITE_SCOPES | MCP_SCOPES), and the resource URL it binds (baseUrl | baseUrl + MCP_PATH).
1. Tests first in connected-apps.test.ts: the form offers a resource radio (Micropub checked by default) and one scope fieldset per resource with field names micropub_scope / mcp_scope; an MCP token calls whoami on /_geekity/mcp and gets 401 at Micropub; a Micropub token gets 401 at MCP; the list row says which resource a created token is for; refusals for an unknown resource and for a scope the chosen resource does not take; a refused form keeps the chosen resource.
2. Form: join radio buttons for the resource; each scope fieldset shown only while its resource is chosen (group-has, the editor's precedent), both visible without CSS. The server reads only the chosen resource's field.
3. POST handler validates against the table and passes the resource URL to createToken.
4. Row: resource label for created tokens, matched by their stored resource.
5. docs/mcp.md: add the site to Claude Code with a personal token (claude mcp add --header). Rebuild admin.css.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The connected apps form has a Works with choice (join radio buttons, Micropub checked by default) and one scope fieldset per resource, fields micropub_scope and mcp_scope. Only the chosen resource's fieldset shows, by group-has CSS like the editor's review kinds; the server reads only the chosen resource's field, so a box ticked under the other resource is ignored. TOKEN_RESOURCES in admin/connected-apps.ts holds each resource's label, hint, scopes (SITE_SCOPES, MCP_SCOPES) and the URL a token is bound to (baseUrl, baseUrl + MCP_PATH). Created tokens get a For Micropub / For MCP badge in the list, matched on their stored resource.

Verified: connected-apps.test.ts covers the form, an MCP token calling whoami on /_geekity/mcp and getting 401 at Micropub, a Micropub token getting 401 at MCP, the badge, refusals (unknown resource, a scope the resource does not take, scopes sent under the other resource) and a refused form keeping MCP chosen. Headless Chrome on the rendered screen with admin.css: Micropub chosen shows only the Micropub scopes (display grid / none), MCP chosen shows only the MCP scopes. pnpm build, test (cms 7553 pass), test:11ty, typecheck, lint, format:check all pass. Docs: docs/mcp.md (With a token you create, claude mcp add --header) and docs/indieweb-sign-in.md (Tokens you create).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created tokens can now be bound to MCP as well as Micropub. The Create a token form asks what the token works with and offers that resource's scopes; an MCP token is bound to {base}/_geekity/mcp and works only there, a Micropub token stays bound to the site. The list badges each created token with its resource. Docs show how to add the site to Claude Code with a pasted token. Proven by tests over HTTP and a headless Chrome check of the scope toggle. No follow-ups.
<!-- SECTION:FINAL_SUMMARY:END -->
