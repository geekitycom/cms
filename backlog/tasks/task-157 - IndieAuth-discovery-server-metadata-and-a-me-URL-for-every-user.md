---
id: TASK-157
title: 'IndieAuth discovery: server metadata and a me URL for every user'
status: To Do
assignee: []
created_date: '2026-09-29 01:52'
updated_date: '2026-09-29 02:16'
labels:
  - indieauth
  - indieweb
milestone: m-24
dependencies:
  - TASK-180
references:
  - 'https://www.rfc-editor.org/rfc/rfc8414'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'
documentation:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
priority: medium
type: feature
ordinal: 181800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An IndieAuth client discovers the authorization server from the URL a person types. Today the only thing Geekity publishes is rel="me" links, so sign-in depends on a third party such as GitHub via indielogin.com. This task makes each user's URL point at the site itself. decision-14 already gives every user a URL at /author/{username}/; that URL is their IndieAuth identity. The site root is the identity of the account Settings > General names as the site author, but only when the Solo author setting (TASK-180) is on; on a multi-author site the root is nobody's identity. Record as a decision which URLs are identities and how a me URL maps to a user, including how a www/non-www or http/https variant is canonicalised.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The server publishes an OAuth 2.0 Authorization Server Metadata document (issuer, authorization_endpoint, token_endpoint, code_challenge_methods_supported with S256, scopes_supported) at a stable URL
- [ ] #2 The site root and every author archive advertise it with both a Link: rel="indieauth-metadata" HTTP header and a <link rel="indieauth-metadata"> in the head, from every theme, not only the default
- [ ] #3 The decision on identity URLs and canonicalisation is recorded
- [ ] #4 README documents that typing the site URL into an IndieAuth client signs you in, and what URL each user types
- [ ] #5 The same metadata document is also served at /.well-known/oauth-authorization-server (RFC 8414), so generic OAuth and MCP clients find it without the IndieAuth link relation
- [ ] #6 A me URL resolves to exactly one user: an author URL to that user, and the site root to the site author only when the Solo author setting (TASK-180) is on; any other URL, and the root on a multi-author site, resolves to none, proven by tests
<!-- AC:END -->
