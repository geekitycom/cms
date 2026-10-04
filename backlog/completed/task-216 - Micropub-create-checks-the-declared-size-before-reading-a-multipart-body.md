---
id: TASK-216
title: Micropub create checks the declared size before reading a multipart body
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 16:22'
updated_date: '2026-10-03 00:07'
labels:
  - micropub
dependencies: []
priority: low
type: bug
ordinal: 232800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The media endpoint (packages/cms/src/micropub/media.ts) refuses a request whose Content-Length exceeds the largest upload limit before the bearer guard reads the body. The create endpoint (POST /_geekity/micropub, packages/cms/src/micropub/endpoint.ts), which accepts photo file parts since TASK-166, reads a multipart body in full with no such check, so an oversized request is buffered before it is refused. Found while building TASK-166.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An oversized multipart create is refused with 413 or 400 before its body is read
- [x] #2 A test proves the refusal without buffering the body
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move refuseOversizedMedia out of src/micropub/media.ts into src/micropub/endpoint.ts as an exported refuseOversizedRequest beside requireSiteToken (media.ts already imports from endpoint.ts), so both Micropub POST routes share one declared-length check against largestUploadLimit + UPLOAD_ENVELOPE_BYTES.
2. Register it on POST /_geekity/micropub after logMicropubRequest and before requireSiteToken, so the activity log still records the 400 and its readBody finds an empty bodyCache and reads nothing.
3. Apply the same limit to every content type at the create route: there is no separate request size limit in the README or config, only uploadMaxBytes/uploadMediaMaxBytes and the proxy's client_max_body_size (README says it must be at least the larger of the two). Record the choice in the notes.
4. Tests first in src/micropub/create.test.ts: a multipart create whose declared length is over the limit gets 400 invalid_request and writes nothing, and its body is a pull-counting ReadableStream (highWaterMark 0) that is never pulled; a JSON create over the limit gets the same; a create under the limit still lands. Activity-log test: the refused create is recorded.
5. README Micropub section: say the declared-length check applies to the endpoint as well as the media endpoint.
6. pnpm build && test && typecheck && lint && format:check; curl the running demo with an oversized Content-Length.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved the media endpoint's declared-length check out of src/micropub/media.ts into src/micropub/endpoint.ts as the exported refuseOversizedRequest, beside requireSiteToken (media.ts already imports from endpoint.ts). Both Micropub POST routes now register it after their activity-log middleware and before the bearer guard, so the log records the 400 and its readBody sees an empty bodyCache and reads nothing.

Limit decision: the README and config name no request size limit other than uploadMaxBytes and uploadMediaMaxBytes, and the README's proxy section tells operators to allow the larger of the two. So every POST to /_geekity/micropub, JSON and form-encoded included, is held to largestUploadLimit + UPLOAD_ENVELOPE_BYTES (8 KiB) by its declared Content-Length, the same as the media endpoint. No new constant or setting. Consequence: the limit covers the whole request, so several photo files in one multipart create share it; each file is still held to its own kind's limit by storeUpload. The README Micropub section now says so. The refusal reuses tooLargeMessage, so a JSON body over the limit is told 'That file is too big', which reads slightly off for a non-file body; left as is.

Tests: create.test.ts 'an oversized create (TASK-216)' sends a ReadableStream body with highWaterMark 0 that counts pulls and asserts 0 pulls on the 400, for multipart and JSON, plus a create inside the limit still landing. Mutation check: with the check moved after requireSiteToken the multipart test fails on 'nothing read the body, 1 !== 0'. activity-log.test.ts logs the refused create as action create, 400, carrying nothing.

Validation: pnpm build, pnpm test (3456 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Live: demo on port 3216, curl POST /_geekity/micropub with Content-Length 10737418240 and a 4-byte body answered 400 invalid_request with cache-control no-store at once (multipart and JSON); a normal-size create with a bad token still gets 401; the media endpoint still answers 400. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Micropub create endpoint now refuses a request whose declared Content-Length is over the larger upload limit plus the 8 KiB envelope with 400 invalid_request before the bearer guard or the handler reads the body, using the check the media endpoint already had, moved to src/micropub/endpoint.ts as refuseOversizedRequest and shared by both routes. The same limit covers JSON and form-encoded creates, since the site names no other request limit; recorded in the notes and the README. Verified with a pull-counting stream test (0 pulls on refusal, mutation-checked), an activity-log test, the full build/test/typecheck/lint/format run, and curl against the running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
