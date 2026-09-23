---
id: TASK-113
title: Logging out on 0.5.0 leaves a cookie that makes every login look stale
status: Done
assignee: []
created_date: '2026-09-20 17:36'
updated_date: '2026-09-20 17:44'
labels:
  - wontfix
dependencies: []
priority: high
type: bug
ordinal: 138800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-103 moved the session cookie from `Path=/admin` to `Path=/` so the public site could draw the comment form for whoever is signed in. A browser that held a login across that upgrade keeps the old cookie as well: same name, different path, so it is a second cookie rather than a replacement. RFC 6265 sends the longer path first and Hono's parser keeps the first of a repeated name, so the dead `/admin` cookie shadows the live one. Once its session is gone the site sees an anonymous request, the login form mints a session the browser then sends second, and the POST is refused with "That form was stale or came from somewhere else." The browser can never get out of it, because each login form mints another cookie the old one keeps shadowing. 0.5.0's logout is what drops such a browser into the trap: it clears only `Path=/`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A browser holding only the pre-0.5.0 `/admin`-scoped cookie can log in again without clearing cookies by hand
- [ ] #2 Every response that sets the session cookie also expires the `/admin`-scoped one
- [ ] #3 Logout clears the cookie at both paths
- [ ] #4 Tests cover the two-cookie case, which the single-value test browser cannot express
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce at the HTTP level: boot a sandbox site, delete the session a `/admin`-scoped cookie names, GET the login form, then POST with both cookies in RFC 6265 order. Expect the 403.
2. Confirm the mechanism in Hono: `parse` in `utils/cookie.js` skips a name already seen, so the first of a repeated name wins.
3. Add a path-aware cookie jar to the admin route tests. The harness `browser` keeps one value per name and so cannot express two cookies that differ only in path.
4. Expire the legacy cookie wherever the new one is written, in `setSessionCookie` and `clearSessionCookie`, so a stuck browser heals on its next page load.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cause confirmed rather than guessed. Searching history for SESSION_COOKIE_PATH puts the path move in 737a886, and that commit is tagged v0.5.0, matching the report. Hono 4.13.7 utils/cookie.js parse does "cookieName in parsedCookie -> continue", so the first of a repeated name wins; RFC 6265 has the browser send the longer path first; the dead /admin cookie therefore shadows the live / one. The other candidate with the same symptom, a Secure/baseUrl mismatch dropping the cookie, is ruled out as a regression: usesSecureCookies has not changed since 7d5a6e3, the original auth commit.

The fix is expireLegacyCookie, called from both setSessionCookie and clearSessionCookie. Setting the cookie is where it matters: a stuck browser heals on its next load of the login form, with no cookie clearing by hand. Clearing it on logout is what stops a browser being dropped into the trap in the first place. It is a migration shim and the comment says when it can go: one session lifetime after the last site upgrades past 0.5.0. Considered and rejected: teaching sessionIdFrom to try every geekity_session the request carries. It would cover any duplicate-cookie case rather than this one, but it widens what a planted cookie can do for no benefit once the legacy path is expired.

Verified: the three new tests go red with the two expireLegacyCookie calls commented out and green with them, so none of them is vacuous. Full suite 2105 + 30 passing, typecheck, eslint and prettier clean. The regression tests needed a path-aware cookie jar in routes.test.ts because the harness browser keeps one value per cookie name, which is exactly what cannot express two cookies differing only in path.

Decision, 2026-09-20: not shipping the shim. The fix described above was written, verified and then reverted. It only ever helps a browser that loaded a pre-0.5.0 admin, that population can only shrink, and a fresh install can never join it. @geekity/cms had 91 npm downloads across 0.3.0, 0.4.0 and 0.5.0 by this date, which is CI and the maintainer, so the affected population was one person, who cleared the cookie by hand and got straight back in. Carrying a migration shim for an already-migrated population of one was not worth it. The acceptance criteria are unchecked because nothing was shipped against them.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Diagnosed, not fixed, by decision. v0.5.0 moved the session cookie from Path=/admin to Path=/ (TASK-103) without retiring the old one, so a browser upgraded across 0.5.0 held two cookies of the same name; RFC 6265 sends the longer path first and Hono keeps the first of a repeated name, so the dead /admin cookie shadowed the live one and every admin POST came back "That form was stale or came from somewhere else" with no way out from inside the browser. Logging out on 0.5.0 is what sprang the trap, because it cleared only Path=/. Cure for anyone who hits it: delete the geekity_session cookie scoped to /admin, or clear the site cookies. A shim expiring the legacy cookie from setSessionCookie and clearSessionCookie was written and verified, then reverted: it can only help a browser that loaded a pre-0.5.0 admin, and that was one already-recovered person. Kept as the written-up explanation so the next person to meet this error finds it in backlog search rather than re-deriving it.
<!-- SECTION:FINAL_SUMMARY:END -->
