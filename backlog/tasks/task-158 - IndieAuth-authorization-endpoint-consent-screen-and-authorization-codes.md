---
id: TASK-158
title: 'IndieAuth authorization endpoint: consent screen and authorization codes'
status: To Do
assignee: []
created_date: '2026-09-29 01:52'
updated_date: '2026-09-29 02:13'
labels:
  - indieauth
  - indieweb
  - admin
milestone: m-24
dependencies:
  - TASK-157
references:
  - 'https://www.rfc-editor.org/rfc/rfc8707'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'
priority: medium
type: feature
ordinal: 182800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The authorization endpoint is where a client sends the person to approve a sign-in. It validates the request (response_type=code, client_id, redirect_uri, state, code_challenge with S256, optional me and scope), requires an admin session, and shows a consent screen naming the client and the scopes asked for. Approving redirects to redirect_uri with a code, state and iss; denying redirects with error=access_denied. The admin login has no return-to today, so signing in from this flow must come back to the pending request. Client information is fetched from the client_id URL (JSON client metadata or h-app) to show a name and logo and to learn allowed redirect URIs; that fetch is driven by whoever starts a sign-in, so it must refuse private and loopback addresses the way webmention fetching does (public-address.ts), with a timeout and size limit. Codes are single use, bound to the client, redirect_uri, PKCE challenge, user and scopes, and expire within minutes; they are short-lived enough to live outside the files decision-9 requires.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid request from a signed-out browser goes through the admin login and lands back on the consent screen for the same request
- [ ] #2 The consent screen shows the client name (or its URL when it publishes none), its redirect host, the me URL being signed in as and each requested scope, and the user can untick scopes before approving
- [ ] #3 Approve redirects to redirect_uri with code, state and iss; Deny redirects with error=access_denied and state
- [ ] #4 A redirect_uri on a different origin from client_id is accepted only when the client metadata lists it; otherwise the endpoint shows an error page and never redirects
- [ ] #5 Requests missing PKCE, using a method other than S256, or with a malformed client_id are refused, proven by tests
- [ ] #6 The client_id fetch refuses private, loopback and link-local addresses and is bounded in time and size, proven by tests
- [ ] #7 A signed-in user can only approve as their own me URL; a me for another user is ignored in favour of the signed-in user
- [ ] #8 The consent form is protected against CSRF; whether the endpoint stays usable in maintenance mode, where /admin is exempt (TASK-130), is decided and tested
- [ ] #9 An optional resource parameter (RFC 8707) is accepted, shown on the consent screen, and carried with the code so the token is issued for that resource
- [ ] #10 Clients identified by a client_id URL work whether its metadata is an IndieAuth h-app or a JSON client metadata document, and the task notes confirm against the current MCP authorization spec whether that covers MCP clients or dynamic client registration (RFC 7591) is also needed
<!-- AC:END -->
