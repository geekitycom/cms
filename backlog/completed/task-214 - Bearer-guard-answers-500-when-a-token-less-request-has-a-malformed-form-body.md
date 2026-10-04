---
id: TASK-214
title: Bearer guard answers 500 when a token-less request has a malformed form body
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 15:31'
updated_date: '2026-10-03 00:02'
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
- [x] #1 A token-less form or multipart request with a malformed body gets 400 invalid_request, not 500
- [x] #2 A test sends such a body to a bearer-guarded route and asserts the 400
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing test in bearer.test.ts: a token-less multipart request whose body does not parse gets 400 invalid_request with the resource_metadata challenge; and a request with a valid header token and the same body reaches the route (route decides).
2. Failing test in activity-log.test.ts: the media endpoint logs that 400 with its error and description (today the log's own formData() re-throws on the cached rejected parse, so the entry would be dropped).
3. bearer.ts: readBody returns a tagged result (fields | unreadable); presentedTokens reports whether the body was unreadable; requireBearer refuses 400 invalid_request when no token came and the body could not be read. A header token still wins and the route refuses the body.
4. activity-log.ts readBody: an unreadable form body counts as no body, so the entry is still written.
5. pnpm build/test/typecheck/lint/format:check; curl the running demo for the 400 and confirm the App activity entry.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Since the TASK-170 bearer fix (header+body token refused), an unreadable form body counts as carrying no token, so a token-less malformed body now answers 401 unauthorized instead of 500. The criterion still wants 400 invalid_request.

Guard: presentedTokens now returns the token Set and whether a form body could not be read. With no token and an unreadable body the guard answers 400 invalid_request (WWW-Authenticate: Bearer error="invalid_request", resource_metadata=...) and 'The form body could not be read, so no access token was found.' A good header token with an unreadable body still passes the guard, so the route refuses the body (media.test.ts 'gets 400 for a body that is not multipart' still passes; new bearer test covers it).

Activity log: its readBody called c.req.formData(), which re-threw Hono's cached rejected parse, so the entry was dropped with a console warning. An unreadable form body now counts as no body, and the 400 is logged with its description and carried: [].

Only multipart can be malformed in practice: an urlencoded body always parses (lenient WHATWG parser), so garbage there is a token-less request and keeps its 401.

Validation: pnpm build && pnpm test (3452 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Curled a scratch site (own content/data dirs) with a token-less 'multipart/form-data; boundary=x' body at /_geekity/micropub and /_geekity/micropub/media: both 400 invalid_request with the challenge; indieauth-activity.json held both entries with status 400, error invalid_request and the description.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A token-less form or multipart request whose body cannot be parsed now gets 400 invalid_request from the bearer guard (it got 500 when filed, 401 after TASK-170). A good header token still leaves an unreadable body to the route. The App activity log no longer drops that entry: its own body read treats an unparseable form as no body. Tests in bearer.test.ts (400 refusal, header-token pass-through) and activity-log.test.ts (logged with description). Verified with the full build/test/typecheck/lint/format run and curl against a running scratch site plus its activity log file.
<!-- SECTION:FINAL_SUMMARY:END -->
