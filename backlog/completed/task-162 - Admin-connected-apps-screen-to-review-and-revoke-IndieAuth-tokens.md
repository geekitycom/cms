---
id: TASK-162
title: 'Admin: connected apps screen to review and revoke IndieAuth tokens'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:53'
updated_date: '2026-10-01 15:14'
labels:
  - indieauth
  - admin
milestone: m-24
dependencies:
  - TASK-161
priority: medium
type: feature
ordinal: 186800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once the site hands out tokens, each user needs to see which apps can act as them and cut one off. Add a screen under the user's profile listing their live tokens: the client name and URL, the scopes, when it was issued, when it was last used and when it expires, with a Revoke button per row. Record last use cheaply enough that serving an API request does not rewrite the token file on every call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A signed-in user sees only their own tokens, each with client, scopes, issued, last used and expiry
- [x] #2 Revoke removes the token, the next API request with it gets 401, and the screen confirms with a flash message
- [x] #3 A user with no tokens sees an empty state that says what connects here
- [x] #4 The screen meets the admin accessibility conventions (table caption, labelled buttons, visible focus)
- [x] #5 README documents the screen and what revoking does
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data: StoredToken gains optional clientName (from the consent screen's client metadata, carried PendingConsent -> AuthorizationCode -> issueTokens) and optional lastUsedAt. Refresh keeps both because it spreads the record.
2. tokens.ts: revokeConnection(dataDir, userId, id) checks listTokens first, then filters by id and userId through update. recordUse(dataDir, id, now) writes lastUsedAt only when the stored value is missing or older than LAST_USE_RESOLUTION_MS (1 hour), so a busy client causes at most one write per connection per hour and no in-memory state is needed.
3. bearer.ts: requireBearer calls recordUse for the accepted token.
4. Admin screen at /admin/users/apps (Users > Connected apps menu child, linked from your own user screen): a table with caption listing only the signed-in user's live connections (client name linking to client_id, scope labels, issued, last used, expires) with a Revoke <client> button per row; empty state explaining Micropub/MCP/IndieAuth apps connect here. POST /admin/users/apps/revoke revokes by id and flashes a notice, or flashes that it was already gone.
5. Tests first: tokens.test (revokeConnection, recordUse throttle), bearer.test (last use recorded and throttled), a connected-apps.test (own tokens only with all columns, revoke -> 401 on introspection + flash, empty state, labelled buttons); keyboard/form-errors tests cover caption and focus.
6. README section; run build/test/typecheck/lint/format and curl a dev server on another port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Client name: the token record had none, and fetching each client_id on every screen view would cost up to 5s per row. The consent screen already reads it, so it now rides PendingConsent -> AuthorizationCode -> StoredToken.clientName (optional; older records fall back to the client_id URL). A refresh spreads the record, so name and last use survive rotation.
Last use: no in-memory map. recordUse(dataDir, token, now) in tokens.ts writes lastUsedAt only when the stored one is missing or older than LAST_USE_RESOLUTION_MS (1 hour), so the record itself throttles writes: at most one rewrite per connection per hour, and it survives restarts. requireBearer calls it after a token is accepted (so introspection and userinfo count as use). It maps over the current file, so it cannot resurrect a connection revoked mid-request.
Expires column shows the connection expiry (refreshExpiresAt), not the 7-day access token expiry: that is the date the app loses access if it stops using it, which is what a person reviewing cares about. The page says so. Connections whose refresh token has expired are hidden.
revokeConnection(dataDir, userId, id, now) returns the revoked record (for the flash) or undefined, writing nothing for an unknown or other user's id.
Screen at /admin/users/apps, Users > Connected apps menu child; CONNECTED_APPS_PATH lives in admin/users.ts because importing indieauth/ from menu.ts made a circular import (CONSENT_PATH TDZ in routes.ts). Mounted before mountUsers, whose /admin/users/:id 404s non-digit ids.
Validation: pnpm build, test (2992 + 30 pass), typecheck, lint, format:check all green. Curled a server on :3457: page lists only ada's Quill with scopes, issued, last used, expiry and a 'Revoke Quill' button; introspect 200 before revoke, revoke 303 to the screen, introspect 401 invalid_token after, flash 'Quill can no longer act as you.', then empty state.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Users > Connected apps at /admin/users/apps: the signed-in user's live IndieAuth connections with client name (linked to client_id), scope labels, connected, last used and expiry, and a per-row 'Revoke <app>' button that deletes the connection via new revokeConnection and flashes a confirmation; an empty state names Micropub and MCP clients. Last use is recorded by requireBearer through recordUse, which writes at most once an hour per connection. Client name is now stored on the token from the consent screen. README documents the screen and revocation. Verified with new tests in connected-apps.test.ts, tokens.test.ts and bearer.test.ts (including that 20 requests within the hour leave the file byte-identical), the keyboard/form-error template sweeps, the full gate suite, and curl against a live server.
<!-- SECTION:FINAL_SUMMARY:END -->
