---
id: TASK-157
title: 'IndieAuth discovery: server metadata and a me URL for every user'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:52'
updated_date: '2026-10-01 14:19'
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
- [x] #1 The server publishes an OAuth 2.0 Authorization Server Metadata document (issuer, authorization_endpoint, token_endpoint, code_challenge_methods_supported with S256, scopes_supported) at a stable URL
- [x] #2 The site root and every author archive advertise it with both a Link: rel="indieauth-metadata" HTTP header and a <link rel="indieauth-metadata"> in the head, from every theme, not only the default
- [x] #3 The decision on identity URLs and canonicalisation is recorded
- [x] #4 README documents that typing the site URL into an IndieAuth client signs you in, and what URL each user types
- [x] #5 The same metadata document is also served at /.well-known/oauth-authorization-server (RFC 8414), so generic OAuth and MCP clients find it without the IndieAuth link relation
- [x] #6 A me URL resolves to exactly one user: an author URL to that user, and the site root to the site author only when the Solo author setting (TASK-180) is on; any other URL, and the root on a multi-author site, resolves to none, proven by tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/indieauth/: discovery.ts holds the paths (metadata at /_geekity/indieauth/metadata, the authorization and token endpoints beside it for TASK-158/160), the scopes supported today, and authorizationServerMetadata(baseUrl) building the RFC 8414 document with issuer = the effective base URL.
2. identity.ts: userForMe(me, {baseUrl, users, settings}) resolves a typed me URL to exactly one user or none. Canonicalisation: parse, lowercase host, accept http or https and a www. prefix toggled against the site host, same port, no userinfo/query/fragment, empty path reads as /, a missing trailing slash on an author path is tolerated. / resolves to the site author only when soloAuthor is on and the author setting names a user; /author/{username}/ to that user; anything else to none.
3. Mount GET routes for the metadata document at both its own path and /.well-known/oauth-authorization-server, JSON, read per request off the settings.
4. Middleware on the public site: for / and every /author/{username}/ answering 2xx or 304, append Link: <metadata>; rel="indieauth-metadata" and inject <link rel="indieauth-metadata"> before </head> of an HTML body, so every theme carries it whatever its layout.
5. Tests first for each AC: metadata fields at both URLs; header and head link on root and author archive under the default theme and a custom theme with its own bare layout; userForMe table of matching and non-matching URLs incl. solo on/off.
6. Record decision on identity URLs and canonicalisation; README section on signing in with your site.
7. Verify with build/test/typecheck/lint/format:check and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New module packages/cms/src/indieauth/. discovery.ts serves the RFC 8414 metadata (issuer = effective base URL with no trailing slash, authorization_endpoint /_geekity/indieauth/auth, token_endpoint /_geekity/indieauth/token, S256, scopes profile and email, response_types code, iss parameter supported) at /_geekity/indieauth/metadata and /.well-known/oauth-authorization-server. Middleware advertiseIndieAuthMetadata (mounted in mountPublicSite after the admin bar) adds the Link header to / and every /author/{username}/ answering 2xx or 304, and injects the <link> before </head> of the HTML, so a custom theme that replaces every layout still carries it (tested with a bare theme). identity.ts userForMe() is the me-to-user rule; decision-23 records it. The decision body was written into the file after backlog decision create, because the CLI has no command to set a decision's content. The anonymous-pages golden for the admin bar was regenerated; its only change is the new Link entry and head link on / and /author/ada/.
Not in scope and left for later tasks: the metadata names the auth and token endpoints before TASK-158/160 mount them; in maintenance mode the identity URLs and the metadata answer 503 (TASK-158 AC #8 decides the endpoint). The README section describes sign-in as it will work once M25 lands.
Validation: pnpm build, pnpm test (2830 pass + 30), pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled a served throwaway site (GEEKITY_BASE_URL=https://curl.example): both metadata URLs return the JSON; / and /author/ada/ carry the Link header and one head link, including over gzip.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each user's author URL, and the site root on a solo author site, now point IndieAuth and OAuth clients at the site's own authorization server. The metadata document is served at /_geekity/indieauth/metadata and /.well-known/oauth-authorization-server; identity URLs carry a Link: rel=indieauth-metadata header and a head <link> injected by the CMS so every theme has them; userForMe() maps a typed me URL to exactly one user or none, tolerating http/https, www and a missing trailing slash. decision-23 records the identity rules and README documents what URL each user types. Verified by new tests in src/indieauth (metadata, advertisement under the default and a bare theme, the me table) and by curling a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
