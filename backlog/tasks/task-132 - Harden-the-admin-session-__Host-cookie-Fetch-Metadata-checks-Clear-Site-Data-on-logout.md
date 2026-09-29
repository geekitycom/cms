---
id: TASK-132
title: >-
  Harden the admin session: __Host- cookie, Fetch Metadata checks,
  Clear-Site-Data on logout
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 03:02'
labels:
  - security
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/security/cookie-attributes/'
  - 'https://specification.website/spec/security/fetch-metadata/'
  - 'https://specification.website/spec/security/clear-site-data/'
priority: medium
type: enhancement
ordinal: 156800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The session cookie is HttpOnly, SameSite=Lax and Secure on https, but it is named geekity_session. A __Host- prefix would bind it to the exact host and path. Admin POSTs rely on synchronizer tokens alone; Sec-Fetch-Site checks add defence in depth and reject cross-site state changes before a handler runs. Logout deletes the cookie but leaves caches and storage behind on a shared device.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Under an https base URL the session cookie is named with the __Host- prefix (Secure, Path=/, no Domain); plain-http development keeps working
- [x] #2 Existing sessions survive the rename, or the upgrade signs people out once with a clear message; the choice is documented
- [x] #3 State-changing admin and signed-in comment requests with Sec-Fetch-Site: cross-site are rejected with 403; requests without Fetch Metadata headers fall back to the token check
- [x] #4 Inbound ActivityPub, webmention and other server-to-server endpoints are unaffected
- [x] #5 The logout response sends Clear-Site-Data covering cookies, cache and storage
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. session.ts: sessionCookieName(config) gives __Host-geekity_session under https and geekity_session over http; set/clear/read use it. SESSION_COOKIE stays the unprefixed name.
2. Upgrade choice: sign out once. On https the guard treats a request that carries only the old geekity_session cookie as signed out: it deletes that session row, expires the old cookie, and queues a flash on a fresh anonymous session saying the sign-in cookie changed. The old name is never accepted as a session on https, so a sibling subdomain cannot plant one (the point of __Host-). The public comment viewer only reads the prefixed name.
3. Fetch Metadata: one predicate crossSiteWrite(c) (unsafe method and Sec-Fetch-Site cross-site or same-site). Guard checks it first, before redirects and the token; the comment POST checks it when the request carries a signed-in session. Absent header falls through to the token check. Nothing else is touched, so inboxes, webmention, contact, moderate/unsubscribe keep taking cross-site POSTs.
4. Logout response sends Clear-Site-Data: "cache", "cookies", "storage".
5. Tests first for each criterion (admin routes, comments signed-in, inbox/webmention/unsubscribe with cross-site metadata); harness browser learns the cookie name.
6. README: login hardening/security section and Upgrading note.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cookie: sessionCookieName(config) in src/admin/session.ts picks __Host-geekity_session under an https baseUrl and geekity_session over http. SESSION_COOKIE keeps its value; SECURE_SESSION_COOKIE and sessionCookieName are new exports.
Upgrade choice (AC2): sign out once. Under https the old geekity_session name is never accepted as a session, because accepting it would let a sibling subdomain plant a session, which is what __Host- closes. The admin guard calls retireOldSessionCookie: it deletes the old session row, expires the old cookie, and when that was a login and there is no current session it starts an anonymous one with a flash asking the person to sign in again. The public comment viewer ignores the old name. Documented in README Session hardening and Upgrading.
Fetch Metadata (AC3): crossSiteWrite(c) refuses a non-GET/HEAD/OPTIONS with Sec-Fetch-Site cross-site or same-site. same-site is refused too (beyond the criterion) because a sibling subdomain is the neighbour __Host- keeps out. It runs first in the admin guard, so login and setup are covered, and in the comment POST only when a signed-in viewer is present. No header falls through to the CSRF token.
AC4: nothing outside the guard and the signed-in comment branch reads the header. Cross-site POST endpoints found: ActivityPub inbox and shared inbox, WordPress inboxes, /_geekity/webmention, /_geekity/contact, /_geekity/moderate, /_geekity/unsubscribe, and the stranger's comment form.
AC5: logout sends Clear-Site-Data: "cache", "cookies", "storage".
Tests: src/admin/session-hardening.test.ts (new), signed-in.test.ts, inbox.test.ts and wordpress.test.ts (signed Follow with cross-site metadata still 202). Red run in a worktree with the production changes reverted: __Host- name missing, old cookie answered 200 not 302, cross-site logout 303 not 403, Clear-Site-Data missing, cross-site signed-in comment accepted. Removed the old routes.test.ts 'is Secure over https' case, subsumed by the __Host- test.
Observation, not fixed: an unsigned form-encoded POST to /inbox/ in a test leaves something holding the event loop for about 40s after cms.close(); signed JSON deliveries do not. Seems to be Fedify's, and it does not affect a running server.
Validation: pnpm build, pnpm test (2375 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Live curl with dist/cli.js serve on a scratch site, GEEKITY_BASE_URL=https://blog.example: Set-Cookie __Host-geekity_session; Path=/; HttpOnly; Secure; SameSite=Lax; cross-site login and logout 403; same-origin login 303; no-metadata bad token 403; old cookie name 302 to login, expires geekity_session, and the login page shows the renamed-cookie notice; logout 303 with clear-site-data: "cache", "cookies", "storage"; webmention, contact and /inbox/ answer the same with and without Sec-Fetch-Site: cross-site. Plain http on port 3978 sets geekity_session without Secure; login 303, dashboard 200. Both servers stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admin sessions under https now use a __Host-geekity_session cookie (Secure, Path=/, no Domain); plain-http development keeps geekity_session. The upgrade signs people out once: the old cookie is retired, and the login form says the sign-in cookie was renamed. The admin guard and the signed-in comment POST refuse state changes whose Sec-Fetch-Site is cross-site or same-site with 403. Requests without the header still depend on the CSRF token. Inboxes, webmention, contact and the email one-click links are untouched. Logout sends Clear-Site-Data: "cache", "cookies", "storage". README has a new Session hardening section and an Upgrading note. Verified with new tests that failed first, the full build, test, typecheck, lint and format run, and curl against a live https-configured server and a plain-http one.
<!-- SECTION:FINAL_SUMMARY:END -->
