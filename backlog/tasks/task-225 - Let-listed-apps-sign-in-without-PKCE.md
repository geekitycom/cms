---
id: TASK-225
title: Let listed apps sign in without PKCE
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 23:53'
updated_date: '2026-10-03 00:33'
labels:
  - indieauth
  - security
  - interop
dependencies: []
references:
  - packages/cms/src/indieauth/request.ts
  - 'https://indieauth.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 240800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
iA Writer finds the site's authorization endpoint (TASK-220) and is then refused, because it sends no PKCE code_challenge (TASK-219, App activity entry of 2026-10-02: client_id https://ia.net/writer, redirect_uri https://ia.net/writer/indieauth/redirect, scope 'create media'). The current IndieAuth spec requires PKCE and the site requires it for everyone (TASK-219's no-legacy decision). Decision on 2026-10-02: make a narrow exception, a per-app allowlist the site owner manages, empty by default. Everyone not on it still needs PKCE.

What PKCE protects against: someone who intercepts the one-time authorization code cannot exchange it without the verifier the app kept. The allowlist limits the exception to apps the owner chose, and the same-host https rule limits it to return addresses that a native app normally claims as a verified universal link or app link.

Rules:
- An authorization request without code_challenge is accepted only when its client_id is on the list AND its redirect_uri is https on the same host as the client_id. Otherwise it is refused as today.
- A code issued without a challenge is marked so. The token endpoint redeems it without a code_verifier. A code issued with a challenge still needs its verifier, so a request cannot downgrade a PKCE sign-in.
- The consent screen tells the owner the app does not use PKCE and is allowed only because it is on the list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin screen (Connected apps, or Settings > Privacy from TASK-223) lists the client_ids allowed without PKCE, lets the owner add and remove one, and starts empty
- [x] #2 An authorization request without code_challenge from a listed client_id, with an https redirect_uri on the client_id's host, reaches the consent screen, which says the app does not use PKCE
- [x] #3 The same request from an unlisted client_id, or with a redirect_uri on another host or not https, is refused as today with 'code_challenge must be an S256 PKCE challenge'
- [x] #4 The token endpoint redeems a code issued without a challenge without a code_verifier, and still refuses a code issued with a challenge when the verifier is missing or wrong
- [x] #5 App activity shows a sign-in allowed without PKCE as such
- [x] #6 Tests cover each rule above, including the downgrade attempt
- [x] #7 README's IndieAuth section documents the list, why it exists, what it risks, and that iA Writer needs it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape first: the PKCE binding is a discriminated union on the request and on the stored code, CodeChallenge = { method: 'S256', value } | { method: 'none' }. The token endpoint and profile redemption decide from the stored code's method, never from what the redeeming request sends, so a request cannot downgrade a PKCE sign-in.

1. Move clientIdentifier out of request.ts into indieauth/client-id.ts (no imports from settings, so admin/settings.ts can use it without an import cycle through discovery.ts).
2. SiteSettings gains clientsWithoutPkce: readonly string[], stored as site.json clientsWithoutPkce, absent when empty, read through clientIdentifier so a bad hand edit is dropped; carried through settings-page saves like menus.
3. parseAuthorizationRequest(params, baseUrl, clientsWithoutPkce): no code_challenge and no code_challenge_method, client_id on the list, redirect_uri https with the client_id's host -> codeChallenge { method: 'none' }; anything else refused as today. Stays pure.
4. AuthorizationCode.codeChallenge becomes CodeChallenge; consent POST copies it from the request. redeemCode requires code_verifier only for an S256 code, after taking the code (a missing verifier on an S256 code spends it and is invalid_request).
5. Consent screen says the app does not use PKCE and is allowed only because it is on the list. Activity log: the consent route notes allowedWithoutPkce; the entry carries it and App activity's PKCE line says so.
6. Users > Connected apps gets an 'Apps allowed without PKCE' section: list, Remove per entry, Add form (validated as a client_id, duplicates refused), CSRF via the admin guard, flash on success.
7. README 'Signing in with your own site': the list, why, what it risks, iA Writer.
8. TDD per criterion: request.test.ts, redeem.test.ts, an end-to-end without-pkce.test.ts (consent, token, profile redemption, downgrade, activity), connected-apps.test.ts for the screen. Then pnpm build/test/typecheck/lint/format:check and a curl run with iA Writer's request.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: CodeChallenge = { method: 'S256', value } | { method: 'none' } (request.ts), carried on AuthorizationRequest and on the stored AuthorizationCode. redeemCode (redeem.ts) decides from grant.codeChallenge.method alone, so the token endpoint and profile redemption at the authorization endpoint share one rule. A code_verifier missing for an S256 code is now invalid_request after the code is taken, so the downgrade attempt spends the code (before, a missing verifier was refused before the take and left the code usable).

Rules as built (parseAuthorizationRequest, now taking clientsWithoutPkce as a plain third argument, still pure): without PKCE only when the request sends neither code_challenge nor code_challenge_method, the client_id matches a listed one (compared as parsed URLs, so host case and default ports do not matter), and redirect_uri is https with exactly the client_id's host (host includes port; a subdomain is another host). A malformed or empty challenge from a listed app is refused. A listed app that sends a challenge keeps PKCE. consent.ts's existing mayRedirect check (same origin or a published redirect_uri) still runs first, unchanged.

Storage: site.json clientsWithoutPkce, a SiteSettings field outside the settings form (excluded from SettingsField, carried by settingsFromForm like menus), written only when non-empty, read through clientIdentifier and deduplicated so a hand edit cannot add a non-client_id. clientIdentifier moved to indieauth/client-id.ts so admin/settings.ts can import it without a cycle through discovery.ts.

Admin: the bottom of Users > Connected apps (/admin/users/apps), with POST /admin/users/apps/without-pkce (add) and /without-pkce/remove. Add trims, validates as a client_id, refuses a duplicate, re-renders 400 with the field error and summary; success flashes and redirects 303. Registered with form-errors.test.ts.

Activity: ActivityNote.allowedWithoutPkce, set by the consent route; the authorization request entry carries allowedWithoutPkce: true, and the entry page's PKCE line says 'Allowed without PKCE: the app is on your list of apps allowed without PKCE'.

Verification: pnpm build, pnpm test (3516 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all clean. Mutation check: making redeemCode skip the verifier check when the request omits code_verifier fails three downgrade tests (redeem.test.ts and without-pkce.test.ts at both endpoints). Curl against a scratch site on :3999 (createCms with temp content/data dirs, stopped after): list empty -> add https://ia.net/writer (303, flash, site.json holds it) -> iA Writer's exact TASK-219 request with no code_challenge reaches the consent screen with the no-PKCE notice -> approve -> token endpoint without code_verifier answers 200 with scope 'create media' -> App activity entry shows allowedWithoutPkce and the notice line. A PKCE sign-in by the same listed app redeemed without the verifier got 400 invalid_request and the retry with the right verifier got invalid_grant (code spent). After Remove, the same request was redirected with error_description 'code_challenge must be an S256 PKCE challenge'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Owners can list apps allowed to sign in without PKCE, under Users > Connected apps. The list is stored as site.json clientsWithoutPkce and starts empty. A request with no PKCE fields is accepted only from a listed client_id whose redirect_uri is https on the client_id's own host. Its code is stored with codeChallenge { method: 'none' }, and a PKCE code is stored with { method: 'S256', value }. redeemCode decides from the stored code alone, so the token endpoint and profile redemption both refuse a PKCE code that has no verifier, and that attempt spends the code. The consent screen says when an app does not use PKCE, App activity marks such sign-ins, and the README documents the list, its risk and iA Writer. Verified with new unit and end-to-end tests (request, redeem, without-pkce, connected-apps, settings), a mutation check on the downgrade rule, the full build/test/typecheck/lint/format gate, and a curl run of iA Writer's exact request through approval and token redemption on a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
