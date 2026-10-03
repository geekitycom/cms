---
id: TASK-238
title: Accept a create token at the Micropub media endpoint
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:12'
updated_date: '2026-10-03 17:08'
labels:
  - micropub
  - interop
  - indieauth
dependencies: []
references:
  - packages/cms/src/micropub/media.ts
  - 'https://micropub.rocks/'
priority: medium
type: bug
ordinal: 253800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
micropub.rocks test 700 (upload a jpg to the media endpoint), run against shll.me on 0.18.0, gets 403 insufficient_scope 'The access token was not granted the media scope.' micropub.rocks signs in asking for 'create update delete undelete' (app/Controller.php:206 in aaronpk/micropub.rocks) and never asks for media, so its token cannot reach the media endpoint, which requires the media scope (requireSiteToken('media') in packages/cms/src/micropub/media.ts).

A create token can already store files: a Micropub create with a photo file part goes through storePhotos (packages/cms/src/micropub/endpoint.ts) and storeUpload. Refusing the same token at the media endpoint protects nothing and breaks clients that treat media as part of create. Accept create or media there; a media-only token still cannot create posts. requireSiteToken takes one scope today, so it needs an any-of form, and the 403 WWW-Authenticate should name what would be accepted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A token with create and without media uploads to the media endpoint (201 with Location), and GET q=last / q=source answer for it
- [x] #2 A token with media and without create can still upload but cannot create a post (403 insufficient_scope on the Micropub endpoint)
- [x] #3 A token with neither gets 403 insufficient_scope naming create or media
- [x] #4 micropub.rocks test 700's request answers 201; README's scope table and micropub.rocks results are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Guard in indieauth/bearer.ts: replace the single `scope` with `scopes`, a non-empty any-of list; a token holding any one passes. insufficientScope takes the list, its description names them joined by 'or', and the WWW-Authenticate scope attribute lists them space-delimited.
2. Migrate callers in the same change: token.ts userinfo (['profile']), micropub/endpoint.ts requireSiteToken(...scopes) and the POST action check ([scope]), bearer.test.ts.
3. media.ts POST uses requireSiteToken('create', 'media'), keeping Micropub's 401.
4. Tests first in media.test.ts: create-only token uploads (201 + Location) and q=last / q=source answer; media-only token uploads but its create on the Micropub endpoint gets 401 insufficient_scope; a token with neither gets 401 naming create or media; replay micropub.rocks 700 (multipart jpg, token from its create update delete sign-in) -> 201.
5. README: scope table rows for create and media, the Uploading media section, and micropub.rocks results.
6. pnpm build, test, typecheck, lint, format:check; curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Guard.scope became Guard.scopes, a non-empty any-of tuple (Scopes in indieauth/bearer.ts); insufficientScope takes the list, says 'create or media' in error_description and lists them space-delimited in the WWW-Authenticate scope attribute (scope="create media"). Callers migrated in the same change: userinfo in token.ts, requireSiteToken and the POST action check in micropub/endpoint.ts, bearer.test.ts. The media POST uses requireSiteToken(['create', 'media']).

AC #2 and #3 say 403; TASK-239 (ab76d72) moved the Micropub and media endpoints to Micropub's 401 for insufficient_scope, so both answer 401 here, and the tests assert 401. The criteria's substance (refused, insufficient_scope, naming create or media) holds.

Validation: tests first in micropub/media.test.ts (three failed before the change: create-only upload, neither-scope refusal, test 700 replay; the media-only case already held and guards against regression). pnpm build, test (3676 + 30 pass), typecheck, lint, format:check all pass. Curl against a scratch site on :3917 with issued tokens: create+update+delete token uploads aaronpk.jpg -> 201 with Location, q=last and q=source answer it; media token uploads -> 201 and its create on /_geekity/micropub -> 401 insufficient_scope scope="create"; update+delete token -> 401 insufficient_scope scope="create media". Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Micropub media endpoint now takes a token with create or media, so micropub.rocks test 700 and other clients that sign in for create alone can upload. The bearer guard gained an any-of scopes list rather than a media.ts special case, and a token with neither gets Micropub's 401 insufficient_scope naming create or media. A media-only token still cannot create a post. README's scope table, Uploading media section and micropub.rocks results say so. Verified by tests in micropub/media.test.ts (including a replay of test 700), the full build/test/typecheck/lint/format run, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
