---
id: TASK-230
title: Create an access token from Connected apps
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 01:32'
updated_date: '2026-10-03 13:28'
labels:
  - indieauth
  - admin
dependencies: []
priority: low
type: feature
ordinal: 245800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some clients and scripts cannot complete IndieAuth sign-in but accept a pasted token: micropub.rocks's Manual tab takes an endpoint and a token (TASK-219, TASK-170). The admin has no way to mint one. Add a Create token action on Users > Connected apps: pick scopes, name it, show the token once, store only its hash like other tokens (data/indieauth-tokens.json), list it with the connected apps and revoke it the same way. TASK-225's allowlist lets micropub.rocks sign in directly, so this is now a convenience for scripts and testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A signed-in admin creates a named token with chosen scopes on Users > Connected apps and sees it once
- [x] #2 The token works as a bearer token on the Micropub endpoint with exactly those scopes, and its plain value is stored nowhere
- [x] #3 The token is listed with the connected apps and revoking it makes the next request answer 401
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: StoredToken in src/indieauth/tokens.ts becomes a union. AppConnection is today's record (clientId, clientName, refresh hash and expiry). CreatedToken is { kind: 'created', name } with the shared fields (id, userId, me, scopes, resource, issuedAt, lastUsedAt, accessTokenHash, expiresAt) and no client and no refresh token. Both live in data/indieauth-tokens.json, so listTokens, verifyAccessToken, findAccessToken, recordUse, revokeToken, revokeConnection and revokeTokensForUser treat them alike; only the hash is written.
1. tokens.ts: split the type, add createToken(dataDir, {userId, me, name, scopes, resource, lifetimeMs}, now) and lapsesAt(token) (refresh expiry for an app, access expiry for a created token), used by the sweep and the screen. refreshTokens and revokeToken match refresh hashes only on apps.
2. Choices: audience bound to the site resource (siteBaseUrl, as requireSiteToken checks); no refresh token; expiry chosen from 7, 30, 90 or 365 days, default 30, never longer than a year; scopes any non-empty subset of SCOPES; owner the signed-in user; me from meForSignIn with the root typed, so a solo author gets the root.
3. connected-apps.ts + apps.njk: a Create a token form (name, scope checkboxes, expiry select) posting to /admin/users/apps/tokens with CSRF and form errors; success renders the screen directly (no redirect, no flash, Cache-Control no-store) with the token shown once; the table lists created tokens by name with the same Revoke button.
4. Introspection omits client_id and the activity log records no client for a created token.
5. Tests first: tokens.test (shape on disk, no plain value, sweep), connected-apps.test (create, shown once, refused input, CSRF, Micropub create with exact scopes, 401 after revoke, introspection), form-errors SEPARATELY variant.
6. Verify with build/test/typecheck/lint/format and a curl run against a served site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: StoredToken (src/indieauth/tokens.ts) is now AppConnection | CreatedToken. CreatedToken is { kind: 'created', id, userId, me, name, scopes, resource, issuedAt, lastUsedAt?, accessTokenHash, expiresAt }: no clientId and no refresh hash, since no client asked for it and nothing could present a refresh token. It sits in data/indieauth-tokens.json beside the apps' records, so verify, recordUse, revokeToken (RFC 7009), revokeConnection (Revoke button) and revokeTokensForUser treat it like any connection. lapsesAt(token) is the date a record can no longer be used (refresh expiry for an app, access expiry for a created token); the sweep and the screen use it.

Decisions:
- Audience: resource = siteBaseUrl(c), the identifier requireSiteToken checks, so the token works at Micropub and its media endpoint and not at a resource with its own identifier (a future /mcp). A change of base URL stops it working, which is the same rule as any bound token.
- Lifetime: no refresh token; the person picks 7, 30, 90 or 365 days, default 30, never more than a year. A pasted token cannot refresh, so the seven-day app lifetime would make a script ask for a new one weekly; a never-expiring token would outlive a leak. A year caps that.
- Scopes: any non-empty subset of SCOPES (discovery.ts); an unknown value is refused rather than dropped, like decision-24's rule that no scope earns no token.
- Owner: the signed-in user. me is meForSignIn with the root typed, so the solo author gets the root and anyone else their author URL.
- Shown once: the POST renders the screen directly with Cache-Control: no-store, not through a flash, because a flash is kept on the session row in geekity.db until the next page. The admin route is not behind the App activity middleware, and a Micropub request made with the token logs no client (bearerFacts), never the token.
- Introspection answers a created token without client_id (RFC 7662 makes it optional).

Validation: pnpm build, pnpm test (3657 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Mutation check: dropping the scope error from the first checkbox fails form-errors.test.ts. Curl run on a served scratch site (dist/cli.js serve, port 3123): login 303; create 200 with cache-control no-store and a 43-character token; GET of the screen does not contain it; Micropub h=entry 201 with Location; action=delete 403 insufficient_scope; grep -rl of the token over data/, content/ and the server log finds nothing; the tokens file holds kind created, resource http://localhost:3123, scopes [create], a hash and a 30-day expiry; Revoke 303; the next Micropub request 401 invalid_token. Server stopped.

Follow-up for review: decision-24 says the file holds one record per approval of a client; it now also holds created tokens. The decision may want an amendment through the CLI.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Create a token to Users > Connected apps. A signed-in user names a token, ticks scopes from SCOPES and picks an expiry (7, 30, 90 or 365 days, default 30); the token is shown once on a no-store response and only its SHA-256 hash is kept, as a CreatedToken record (kind created, no client, no refresh token) in data/indieauth-tokens.json, bound to the site resource. It is listed with the apps, revoked by the same button or RFC 7009, introspected without client_id, and lapses at its expiry. Verified by new tests in tokens.test.ts and connected-apps.test.ts (Micropub create 201, delete 403, no file holds the value, 401 after revoke), a form-errors variant, the full gate suite, and a curl run against a served site.
<!-- SECTION:FINAL_SUMMARY:END -->
