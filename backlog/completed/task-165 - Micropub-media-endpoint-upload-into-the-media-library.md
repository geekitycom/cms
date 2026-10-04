---
id: TASK-165
title: 'Micropub media endpoint: upload into the media library'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-02 15:29'
labels:
  - micropub
  - media
milestone: m-25
dependencies:
  - TASK-163
references:
  - 'https://www.w3.org/TR/micropub/#media-endpoint'
  - packages/cms/src/admin/uploads.ts
priority: medium
type: feature
ordinal: 189800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clients upload a photo first and then reference its URL in a post. A multipart POST with a file part stores it in the media library through the same path the admin upload uses (decision-10: the original under content/uploads, variants derived), with the same size and type limits, and answers 201 with the file's URL. Advertised as media-endpoint in q=config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A multipart upload returns 201 with a Location the file is served at, and the file appears in the admin media library
- [x] #2 Uploads over the admin limit or of a type the media library refuses get 400, and nothing is stored
- [x] #3 A token without the media scope gets 403 insufficient_scope
- [x] #4 GET ?q=last returns the URL of the most recent upload by the token's user
- [x] #5 q=config names the media endpoint
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a media upload is storeUpload's StoredUpload; the only new state is the last upload per user, a dataDir file micropub-media.json mapping user id to the upload's site path (/uploads/yyyy/mm/name), written with updateFileAtomically.
2. src/micropub/media.ts: mountMicropubMedia on MICROPUB_MEDIA_PATH. POST: a Content-Length check before the bearer guard (the guard parses form bodies for access_token), then requireSiteToken('media'), then storeUpload(body.file, config); a refusal (400/413/415) answers 400 invalid_request with the media library's message; success records the last upload and answers 201 with an absolute Location. GET: requireSiteToken(), q=last answers {url} of the user's last upload, or {} when none or the file is gone; any other q is 400.
3. Export requireSiteToken from endpoint.ts and largestUploadLimit from admin/uploads.ts rather than copying them; mount beside mountMicropub in index.ts.
4. Tests first in src/micropub/media.test.ts, one per AC: 201 + Location served + listed by listUploads; oversize (body and Content-Length) and refused type get 400 with nothing stored; create-only token gets 403 insufficient_scope; q=last per user; q=config still names the endpoint.
5. Extend the README Micropub section; run build, test, typecheck, lint, format:check; curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/micropub/media.ts (mountMicropubMedia, mounted beside mountMicropub in index.ts). POST stores the 'file' part with storeUpload, the admin media library's own function, so limits, the type allowlist, signature checks, content/uploads/{yyyy}/{mm} placement and sharp variants (decision-10) are the library's. Every storeUpload refusal (400/413/415) is answered as Micropub's 400 invalid_request with the library's message, as the AC asks. A Content-Length pre-check runs before the bearer guard, because the guard parses form bodies for access_token and would read the whole file first; a malformed multipart body is 400 rather than the 500 Hono's parser would throw.

Scope: POST needs media (requireSiteToken('media'), now exported from endpoint.ts); GET ?q=last takes any live site token, like the endpoint's other queries. largestUploadLimit is now exported from admin/uploads.ts.

q=last: the spec does not define it (it is the micropub-extensions convention Quill used). It answers {"url": absolute} for the token user's last upload through this endpoint, or {} when there is none or the file was deleted since. Kept per user id in dataDir/micropub-media.json via updateFileAtomically. No time window is applied. Uploads made in the admin do not count as the user's last upload, since the admin records no uploader.

Verification: pnpm build && pnpm test (3277 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. 13 tests in src/micropub/media.test.ts; a mutation removing the Content-Length check turned its test red (500). Curl against a scratch server (createCms, uploadMaxBytes 4096): upload 201 with Location http://localhost:4917/uploads/2026/10/photo.png, GET of it 200 image/png with the same 126 bytes, variants 40.png/40.webp derived, signed-in /admin/media lists it; 8 KiB png 400 'too big', .sh 400 'not allowed', create-only token 403 insufficient_scope with scope="media", q=last {} before and the URL after, q=config names /_geekity/micropub/media. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the Micropub media endpoint at /_geekity/micropub/media. A multipart upload with a file part goes through the media library's storeUpload, answers 201 with the file's absolute URL in Location, and shows up on the admin media screen with its variants derived. Over-limit, refused-type and malformed uploads get 400 invalid_request with nothing stored; a token without the media scope gets 403 insufficient_scope. GET ?q=last answers the token user's most recent upload, kept per user in dataDir/micropub-media.json. README's Micropub section documents it. Verified by 13 new tests, the full build/test/typecheck/lint/format run, and curl against a running site including the signed-in media screen.
<!-- SECTION:FINAL_SUMMARY:END -->
