---
id: TASK-161
title: >-
  Bearer-token authentication for API routes, with introspection, revocation and
  userinfo
status: To Do
assignee: []
created_date: '2026-09-29 01:53'
updated_date: '2026-09-29 02:13'
labels:
  - indieauth
  - indieweb
  - micropub
milestone: m-24
dependencies:
  - TASK-160
references:
  - 'https://www.rfc-editor.org/rfc/rfc9728'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'
priority: medium
type: feature
ordinal: 185800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The resource-server half that a Micropub endpoint will stand on. One piece of middleware turns an Authorization: Bearer header (or an access_token form field, which Micropub allows) into the user and scopes it grants, and lets a route require a scope. The same lookup backs the introspection endpoint, and the server also exposes token revocation and a userinfo endpoint; all three are advertised in the metadata document from TASK-157. Micropub itself is out of scope for this milestone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A route guarded by the middleware gets the user and granted scopes for a valid token; a missing, unknown, expired or revoked token gets 401 and a token lacking the required scope gets 403 insufficient_scope, proven by tests
- [ ] #2 The introspection endpoint answers active true with me, client_id, scope and exp for a live token and active false otherwise, and requires authorization of its own
- [ ] #3 The revocation endpoint revokes a token so the middleware and introspection refuse it immediately
- [ ] #4 The userinfo endpoint returns name, url, photo and email per the profile and email scopes
- [ ] #5 The metadata document lists introspection_endpoint, revocation_endpoint and userinfo_endpoint
- [ ] #6 Protected resource metadata (RFC 9728) is served at /.well-known/oauth-protected-resource, naming the authorization server and supported scopes
- [ ] #7 A 401 from a guarded route carries WWW-Authenticate: Bearer with resource_metadata pointing at that document, so an MCP client can discover how to sign in
<!-- AC:END -->
