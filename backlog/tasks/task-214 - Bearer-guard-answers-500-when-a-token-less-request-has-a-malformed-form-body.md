---
id: TASK-214
title: Bearer guard answers 500 when a token-less request has a malformed form body
status: To Do
assignee: []
created_date: '2026-10-02 15:31'
labels:
  - indieauth
  - micropub
dependencies: []
priority: medium
type: bug
ordinal: 230800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
requireBearer's presentedToken (packages/cms/src/indieauth/bearer.ts:84) calls c.req.parseBody() without a try when the request has no Authorization header and a form or multipart content type. A malformed body throws and the request answers 500 instead of 400 invalid_request. Micropub endpoints (TASK-164, TASK-165) sit behind this guard, so a broken client upload or micropub.rocks negative test surfaces as a server error. Found while building TASK-165.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A token-less form or multipart request with a malformed body gets 400 invalid_request, not 500
- [ ] #2 A test sends such a body to a bearer-guarded route and asserts the 400
<!-- AC:END -->
