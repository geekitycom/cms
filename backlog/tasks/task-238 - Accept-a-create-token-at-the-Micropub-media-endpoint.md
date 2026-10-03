---
id: TASK-238
title: Accept a create token at the Micropub media endpoint
status: To Do
assignee: []
created_date: '2026-10-03 16:12'
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
- [ ] #1 A token with create and without media uploads to the media endpoint (201 with Location), and GET q=last / q=source answer for it
- [ ] #2 A token with media and without create can still upload but cannot create a post (403 insufficient_scope on the Micropub endpoint)
- [ ] #3 A token with neither gets 403 insufficient_scope naming create or media
- [ ] #4 micropub.rocks test 700's request answers 201; README's scope table and micropub.rocks results are updated
<!-- AC:END -->
