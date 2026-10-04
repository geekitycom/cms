---
id: TASK-239
title: Answer insufficient_scope with 401 on the Micropub endpoints
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:16'
updated_date: '2026-10-03 17:02'
labels:
  - micropub
  - interop
  - indieauth
dependencies: []
references:
  - 'https://www.w3.org/TR/micropub/'
  - packages/cms/src/indieauth/bearer.ts
priority: low
type: bug
ordinal: 254800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
micropub.rocks test 804 (a token without create posts a note) gets 403 insufficient_scope and reports 'It did not return HTTP 401 but it did return a correct error response'. The Micropub spec's error table (section 3.8) gives insufficient_scope as HTTP 401; RFC 6750 section 3.1, which the shared bearer guard (requireBearer, insufficientScope in packages/cms/src/indieauth/bearer.ts) follows, gives 403. For a Micropub endpoint the Micropub spec wins, since its clients read errors by that table. The README's Micropub section says the site answers 403 'as the Micropub spec says'; that is wrong and was never checked against the spec.

Answer insufficient_scope with 401 on the Micropub endpoint and the media endpoint, with the same JSON body and WWW-Authenticate: Bearer error="insufficient_scope", scope="...". Other bearer-protected API routes keep RFC 6750's 403. Name the choice per route rather than branching on the path inside the guard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub or media request whose token lacks the scope answers 401 with error insufficient_scope, the needed scope, and the WWW-Authenticate header
- [x] #2 Other bearer-protected routes still answer 403 for insufficient_scope
- [x] #3 micropub.rocks test 804's request answers 401; README's Micropub and micropub.rocks sections cite the Micropub spec's table correctly
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Guard gains an optional insufficientScopeStatus (401 | 403, default RFC 6750's 403); insufficientScope takes the status as a parameter.
2. requireSiteToken (Micropub and media) passes 401, and the Micropub POST's per-action check passes 401 through one named constant, MICROPUB_INSUFFICIENT_SCOPE_STATUS, so TASK-238's any-of scopes keep it.
3. Tests first: create/update/media/connected-apps/activity-log assertions move to 401 with error, scope and WWW-Authenticate; a replay of micropub.rocks 804 (form create with a token lacking create); bearer.test and introspection.test keep 403.
4. README: the Micropub, media and conformance sections cite Micropub section 3.8 (401) and keep 403 for the other bearer routes; drop 804 from the failing list.
5. Verify with build, test, typecheck, lint, format:check, and curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The Guard names insufficientScopeStatus (401 | 403, default RFC 6750's 403). requireSiteToken, the guard for the Micropub and media endpoints, passes 401 through MICROPUB_INSUFFICIENT_SCOPE_STATUS in micropub/endpoint.ts, and the Micropub POST's per-action check passes the same constant to insufficientScope, which now takes the status. The guard never looks at the path. TASK-238 can change requireSiteToken's scope argument without touching the status.

Tests: create.test.ts asserts 401 with the exact WWW-Authenticate for a form create without create, and replays micropub.rocks 804 (h=entry&content=Hello+World with an update-only token) to 401. media.test.ts, update.test.ts, connected-apps.test.ts and activity-log.test.ts moved to 401. bearer.test.ts and introspection.test.ts (userinfo) still assert 403, unchanged.

Curl against a scratch site on :3939: the 804 request answered 401 with error=insufficient_scope, scope=create; a media upload with a create-only token answered 401 with scope=media; userinfo with an update-only token answered 403 with scope=profile. Server stopped.

README: the bearer paragraph says 401 on Micropub and media per the Micropub spec's error table (linked to #error-response, anchor checked) and 403 elsewhere per RFC 6750 section 3.1; the Micropub scopes and media sections say 401; 804 is out of the micropub.rocks exceptions list.

Validation: pnpm build && pnpm test (3673 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub and media endpoints now answer a token without the needed scope with 401 insufficient_scope, as Micropub section 3.8 says, keeping the JSON body and WWW-Authenticate challenge. The status is a per-route Guard field (default 403), so introspection, userinfo and other bearer routes keep RFC 6750's 403. README corrected and 804 dropped from the micropub.rocks exceptions. Verified by tests, a replay of micropub.rocks 804, curl against a running site, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
