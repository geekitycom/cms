---
id: TASK-239
title: Answer insufficient_scope with 401 on the Micropub endpoints
status: To Do
assignee: []
created_date: '2026-10-03 16:16'
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
- [ ] #1 A Micropub or media request whose token lacks the scope answers 401 with error insufficient_scope, the needed scope, and the WWW-Authenticate header
- [ ] #2 Other bearer-protected routes still answer 403 for insufficient_scope
- [ ] #3 micropub.rocks test 804's request answers 401; README's Micropub and micropub.rocks sections cite the Micropub spec's table correctly
<!-- AC:END -->
