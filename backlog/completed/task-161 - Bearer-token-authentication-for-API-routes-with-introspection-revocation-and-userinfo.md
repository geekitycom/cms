---
id: TASK-161
title: >-
  Bearer-token authentication for API routes, with introspection, revocation and
  userinfo
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:53'
updated_date: '2026-10-01 15:05'
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
- [x] #1 A route guarded by the middleware gets the user and granted scopes for a valid token; a missing, unknown, expired or revoked token gets 401 and a token lacking the required scope gets 403 insufficient_scope, proven by tests
- [x] #2 The introspection endpoint answers active true with me, client_id, scope and exp for a live token and active false otherwise, and requires authorization of its own
- [x] #3 The revocation endpoint revokes a token so the middleware and introspection refuse it immediately
- [x] #4 The userinfo endpoint returns name, url, photo and email per the profile and email scopes
- [x] #5 The metadata document lists introspection_endpoint, revocation_endpoint and userinfo_endpoint
- [x] #6 Protected resource metadata (RFC 9728) is served at /.well-known/oauth-protected-resource, naming the authorization server and supported scopes
- [x] #7 A 401 from a guarded route carries WWW-Authenticate: Bearer with resource_metadata pointing at that document, so an MCP client can discover how to sign in
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. tokens.ts: split findAccessToken (live, any audience) out of verifyAccessToken; add revokeToken (access or refresh hash; listTokens first so an unknown token writes nothing).
2. New src/indieauth/bearer.ts: requireBearer({ audience, scope? }) middleware. Token from Authorization: Bearer, else an access_token field of a form body. Sets c.var.bearer = { token, user }. Missing -> 401 unauthorized; unknown/expired/revoked/wrong audience/user gone -> 401 invalid_token; lacking scope -> 403 insufficient_scope. Every 401/403 carries WWW-Authenticate: Bearer with resource_metadata. audience 'authorization-server' means the server's own endpoints, which take any live token of this site.
3. discovery.ts: paths and metadata fields introspection_endpoint, revocation_endpoint, userinfo_endpoint; protected resource metadata (RFC 9728) at /.well-known/oauth-protected-resource: resource = base URL, authorization_servers = [issuer], scopes_supported, bearer_methods_supported.
4. New src/indieauth/resource.ts mounting introspection (POST token, authorized by a bearer token of the same user; active false otherwise), revocation (POST token, 200 always, RFC 7009), userinfo (GET, profile scope required, email with email scope). Mounted beside the token endpoint, behind the maintenance gate.
5. Tests first for each AC (bearer.test.ts, resource.test.ts, discovery additions), then code. Curl a running site on a spare port.
Last-use tracking left to TASK-162.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the resource-server half on decision-24's store.

- tokens.ts: findAccessToken (live token, any audience) split out of verifyAccessToken, which now adds only the resource check. revokeToken(dataDir, token, now) ends the connection matching either hash, checks listTokens first so an unknown token writes nothing, and answers whether there was one.
- bearer.ts: requireBearer({ audience, scope? }) sets c.var.bearer = { token, user } (BearerEnv). Token from Authorization: Bearer, else an access_token field of a urlencoded or multipart body. Missing gives 401 unauthorized; unknown, expired, revoked, refresh token, wrong resource or deleted user gives 401 invalid_token; missing scope gives 403 insufficient_scope with scope=. Every refusal carries WWW-Authenticate: Bearer ... resource_metadata="{base}/.well-known/oauth-protected-resource". audience 'authorization-server' takes any live token the site issued (used by introspection and userinfo).
- discovery.ts: INTROSPECTION_PATH, REVOCATION_PATH, USERINFO_PATH, PROTECTED_RESOURCE_METADATA_PATH; three new metadata fields; protectedResourceMetadata(baseUrl) with resource = base URL, authorization_servers = [issuer], scopes_supported = SCOPES, bearer_methods_supported = [header, body]. siteBaseUrl is exported and takes only { var: { config } }, because Hono's Context is invariant in its env.
- token.ts: mountTokenInfoEndpoints mounts introspect (POST), revoke (POST, 200 always per RFC 7009) and userinfo (GET, profile scope). Mounted in index.ts after the token endpoint, behind the maintenance gate.
- Decision: introspection is authorized by another live token of this site and answers active only for tokens held by the same user. Everything else gets active false. The IndieAuth spec asks for some authorization and leaves the form open. This rule needs no new secret and stops one person's token from reading another's.
- The protected resource document names the whole site (resource = base URL). A per-endpoint document such as /.well-known/oauth-protected-resource/mcp is left for the MCP endpoint's task.
- Last-use tracking is not here. It is left for TASK-162: requireBearer is the natural hook, and it must not rewrite the file per request.
- README documents the guard, the resource metadata and the three endpoints.

Validation: pnpm build, pnpm test (2974 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. New tests in bearer.test.ts, introspection.test.ts, tokens.test.ts and discovery.test.ts failed first, for the intended reasons (missing export, absent metadata fields, 404s). Mutation check: dropping the same-user rule failed 'answers active false for somebody else's token', and dropping the scope check failed both 403 tests. Curled a throwaway site on :3457. The PRM, the metadata endpoints and userinfo (401 with resource_metadata, 200 profile+email, 403 insufficient_scope) all answered as specified. Introspect gave 401 without auth and active true with it. Revoke gave 200, after which introspect said active false and userinfo gave 401 invalid_token.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added bearer-token authentication for API routes. requireBearer in src/indieauth/bearer.ts hands a route the user and the granted scopes. It answers 401, or 403 insufficient_scope, with WWW-Authenticate pointing at a new RFC 9728 document at /.well-known/oauth-protected-resource. The site now has introspection, revocation and userinfo endpoints, and the authorization server metadata lists them. Introspection is authorized by a same-user token. tokens.ts gains findAccessToken and revokeToken. Verified with new failing-first tests, mutation checks, the full build/test/typecheck/lint/format gate, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
