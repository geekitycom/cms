---
id: TASK-160
title: 'IndieAuth token endpoint: scoped access tokens kept in data/'
status: To Do
assignee: []
created_date: '2026-09-29 01:52'
updated_date: '2026-09-29 02:13'
labels:
  - indieauth
  - indieweb
  - micropub
milestone: m-24
dependencies:
  - TASK-159
references:
  - 'https://www.rfc-editor.org/rfc/rfc8707'
documentation:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
priority: medium
type: feature
ordinal: 184800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phase 2 begins here. A client that wants to act for the person (a Micropub client such as Quill or Indigenous) redeems its code at the token endpoint instead and receives a bearer access token for the approved scopes (create, update, delete, media, and profile/email). A token is irreducible state under decision-9, so issued tokens live in a file in data/ written 0600 like users.json, storing only a hash of each token with its user, client, scopes, issue time and expiry. Whether to issue refresh tokens, and the default token lifetime, are decisions to record. The consent screen from TASK-158 offers the Micropub scopes once this lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Redeeming a code at the token endpoint returns access_token, token_type Bearer, scope, me and expires_in, with profile when that scope was granted
- [ ] #2 The code rules from profile redemption (PKCE, client_id, redirect_uri, expiry, single use) apply here, sharing one implementation
- [ ] #3 Tokens persist in a data/ file holding hashes, never the token itself; deleting geekity.db loses no token, proven by a test
- [ ] #4 Deleting a user revokes every token they hold
- [ ] #5 If refresh tokens are issued, a refresh rotates the token and the old one stops working
- [ ] #6 The decisions on token storage, lifetime and refresh are recorded
- [ ] #7 A token is bound to the resource it was issued for (the site's Micropub and MCP endpoints are separate resources), and a resource server refuses a token issued for another
<!-- AC:END -->
