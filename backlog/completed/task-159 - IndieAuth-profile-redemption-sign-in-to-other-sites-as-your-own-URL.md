---
id: TASK-159
title: 'IndieAuth profile redemption: sign in to other sites as your own URL'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:52'
updated_date: '2026-10-01 16:45'
labels:
  - indieauth
  - indieweb
milestone: m-24
dependencies:
  - TASK-158
references:
  - 'https://indieauth.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 183800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Completes phase 1. A client that only needs to know who the person is redeems its code with a POST to the authorization endpoint (grant_type=authorization_code, code, client_id, redirect_uri, code_verifier) and receives the canonical me URL, plus the profile (name, url, photo) and email when those scopes were granted. No access token is issued on this path. Verify end to end against a real client, indielogin.com, on a deployed site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A correct redemption returns JSON with me, and profile and email only when those scopes were approved
- [x] #2 A wrong code_verifier, client_id or redirect_uri, an expired code or a code already redeemed returns invalid_grant, and a replayed code is refused, proven by tests
- [x] #3 The returned me shares a host with the URL the person typed, so clients accept it
- [x] #4 An end-to-end test drives a simulated client from discovery through consent to redemption against the running app
- [x] #5 Signing in to indielogin.com with the deployed site URL succeeds with no rel="me" provider involved, and the result is noted on the task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/indieauth/redeem.ts: redeemCode(codes, params) checks grant_type (authorization_code, or absent for older clients), takes the code once, then compares client_id and redirect_uri exactly and base64url(sha256(code_verifier)) with the stored challenge; every mismatch, an expired code and a used one answer invalid_grant. TASK-160's token endpoint reuses it. profileResponse(grant, user, baseUrl) builds { me, profile? } with name, url, photo under profile and email under it only when that scope was approved.
2. Mount POST AUTHORIZATION_PATH beside the GET in consent.ts: parse the form body, redeem, look the user up (gone means invalid_grant), answer JSON with Cache-Control no-store; OAuth errors as 400 JSON.
3. Tests first: redeem.test.ts for each refusal and replay; consent.test.ts-style HTTP tests for the response shapes and scopes; me shares a host with the typed URL for root, author URL and someone else's URL.
4. End-to-end test against cms.serve() on a real port: a simulated client discovers the metadata from the typed URL, sends the person through login and consent, redeems the code over HTTP, and rediscovers the returned me.
5. AC5 (indielogin.com on the deployed site) needs a deploy; leave unchecked with a note.
6. Run build, test, typecheck, lint, format:check; curl the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/indieauth/redeem.ts: redeemCode(codes, form) is the one redemption rule (grant_type authorization_code or absent for pre-2020 clients; code, client_id, redirect_uri, code_verifier required as invalid_request; code taken before checks so any failed try spends it; exact client_id and redirect_uri; base64url(sha256(verifier)) === codeChallenge; all failures invalid_grant). TASK-160's token endpoint should call it, not reimplement it. profileResponse(grant, user, baseUrl) answers { me } plus profile { name, url, photo } for the profile scope and profile.email for the email scope, as the IndieAuth spec nests it. url is the me; photo is the avatar made absolute with federation's avatarUrl.
POST /_geekity/indieauth/auth is mounted in mountAuthorizationEndpoint (consent.ts), outside /admin, answers JSON with Cache-Control no-store, OAuth errors as 400 JSON, and invalid_grant when the approving user was deleted since. 503 in maintenance mode like the GET.
README: one paragraph under Signing in with your own site on what the app gets back.
Evidence: redeem.test.ts (19 unit tests: each refusal, expiry, replay, grant_type, missing fields, response shape); consent.test.ts 'redeeming a code for the profile' and 'the me a redemption hands back' (HTTP through login and consent; me shares a host with the typed URL for the root, the root without slash, an author URL without slash, and another user's URL); sign-in.test.ts drives a client over real HTTP against cms.serve() on a free port: Link discovery from the typed URL, metadata, authorization endpoint, admin login, consent, approve with iss check, redemption with no session, then rediscovery of the returned me. pnpm build, test (2912 + 30 pass), typecheck, lint, format:check all pass. Curled the running demo: unknown code 400 invalid_grant with cache-control no-store, missing fields 400 invalid_request, grant_type=password 400 unsupported_grant_type.
AC3 caveat: decision-23 reads a typed www. host as the bare host, so typing www.example.com hands back example.com; the client then accepts it by discovering the same authorization endpoint, as the spec allows. AC3 is proven for every non-www spelling.
AC5 left unchecked: it needs the deployed site and a real indielogin.com sign-in, which this run cannot do. Task stays In Progress until someone signs in to indielogin.com with the deployed URL and notes the result here.

2026-10-01: the site owner verified signing in to indielogin.com with https://shll.me as the URL, which completed against this site's own IndieAuth server with no rel="me" provider involved.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Codes redeem at the authorization endpoint for the canonical me and scoped profile through one shared redeemCode (client_id, redirect_uri and PKCE checked; failures spend the code). Verified by redeem/consent/sign-in tests over real HTTP, curl against a running site, and a live indielogin.com sign-in with https://shll.me confirmed by the site owner.
<!-- SECTION:FINAL_SUMMARY:END -->
