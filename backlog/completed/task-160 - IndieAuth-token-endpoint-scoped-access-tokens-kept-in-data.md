---
id: TASK-160
title: 'IndieAuth token endpoint: scoped access tokens kept in data/'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:52'
updated_date: '2026-10-01 14:55'
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
- [x] #1 Redeeming a code at the token endpoint returns access_token, token_type Bearer, scope, me and expires_in, with profile when that scope was granted
- [x] #2 The code rules from profile redemption (PKCE, client_id, redirect_uri, expiry, single use) apply here, sharing one implementation
- [x] #3 Tokens persist in a data/ file holding hashes, never the token itself; deleting geekity.db loses no token, proven by a test
- [x] #4 Deleting a user revokes every token they hold
- [x] #5 If refresh tokens are issued, a refresh rotates the token and the old one stops working
- [x] #6 The decisions on token storage, lifetime and refresh are recorded
- [x] #7 A token is bound to the resource it was issued for (the site's Micropub and MCP endpoints are separate resources), and a resource server refuses a token issued for another
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: data/indieauth-tokens.json (0600), one record per connection: id, userId, me, clientId, scopes, resource?, issuedAt, accessTokenHash + expiresAt, refreshTokenHash + refreshExpiresAt. SHA-256 of 32 random bytes, never the token. New module src/indieauth/tokens.ts owns read/issue/refresh/verify/revoke-for-user, writes through updateFileAtomically, sweeps dead records on each write.
2. Add Micropub scopes (create, update, delete, media) to SCOPES with consent labels; add refresh_token to grant_types_supported.
3. Token endpoint src/indieauth/token.ts mounted at TOKEN_PATH beside the authorization endpoint (outside /admin, 503 in maintenance): authorization_code goes through redeemCode; a code with no scope is refused (IndieAuth spec); a resource named at the token request must equal the code's (invalid_target). Answer access_token, token_type Bearer, scope, expires_in, refresh_token and profileResponse (me, profile?). grant_type=refresh_token rotates both tokens, client_id must match, scope may narrow.
4. Resource binding: verifyAccessToken(dataDir, token, audience) refuses a token bound to another resource; unbound tokens (Micropub clients send no resource) are accepted only by a resource server that opts in.
5. deleteUser in accounts.ts revokes the user's tokens, so every caller (admin screen, package API) does.
6. Record decision-24 on storage, lifetime (access 7 days, refresh 60 days sliding) and refresh rotation; README section.
7. TDD each criterion: unit tests for tokens.ts, HTTP tests for the endpoint, a test deleting geekity.db and reopening, curl the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/indieauth/tokens.ts (store) and src/indieauth/token.ts (endpoint at TOKEN_PATH, mounted beside the authorization endpoint in index.ts, so outside /admin and 503 in maintenance).

- Store: data/indieauth-tokens.json, 0600, one record per connection {id, userId, me, clientId, scopes, resource?, issuedAt, accessTokenHash, expiresAt, refreshTokenHash, refreshExpiresAt}. SHA-256 of 32 random bytes; tokens never written. Writes via updateFileAtomically; each write sweeps records whose refresh token expired. A refused refresh writes nothing (found live on the demo: a bogus refresh created an empty file; test added, fixed).
- Endpoint: authorization_code goes through the shared redeemCode (one implementation; the form parsing moved to redemptionForm in redeem.ts and both endpoints use it). A no-scope code gets invalid_grant per the IndieAuth spec. A resource at the token request must equal the approved one (invalid_target). Answer: access_token, token_type Bearer, scope, expires_in, refresh_token, then profileResponse (me, profile?). grant_type=refresh_token rotates both hashes in place, same client only.
- Binding: verifyAccessToken(dataDir, token, {resource, acceptsUnbound}, now). Bound tokens work only at their resource; unbound ones only where the resource server opts in (Micropub yes, MCP no).
- deleteUser in accounts.ts calls revokeTokensForUser, so the admin screen and the package API both revoke.
- Scopes: SCOPES gains create, update, delete, media with consent labels; metadata grant_types_supported gains refresh_token. request.test used create as an unoffered scope; now uses draft.
- decision-24 created with backlog decision create; the CLI has no body option, so its Context/Decision/Consequences were filled in the generated file, as decision-23 was.
- README (root) and packages/cms/README.md data tables document the file.

Validation: pnpm build && pnpm test (2943 pass, 0 fail; 11ty 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Mutation checks: removing the revoke from deleteUser, accepting any resource, and keeping the old access hash on refresh each turn the matching tests red. Real HTTP on a scratch site at 127.0.0.1:3917: login + consent, curl redeem -> 200 with Bearer, scope, expires_in 604800, refresh_token, me, profile; replay -> invalid_grant; tokens file mode 0600 contains neither token; refresh -> new pair; old refresh -> invalid_grant. Demo at :3000 curled for metadata (scopes, refresh_token grant) and refusals.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the IndieAuth token endpoint at /_geekity/indieauth/token. A code approved with Micropub scopes (create, update, delete, media, now offered on the consent screen) is redeemed through the shared redeemCode for a seven-day bearer token plus a 60-day refresh token that rotates both on use. Tokens persist as SHA-256 hashes in data/indieauth-tokens.json (0600), survive deleting geekity.db, are revoked when their user is deleted, and are bound to the RFC 8707 resource they were approved for via verifyAccessToken's audience. decision-24 records storage, lifetime and refresh. Verified by new tokens.test.ts and token.test.ts, mutation checks, the full gate, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
