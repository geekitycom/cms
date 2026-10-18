---
id: TASK-421
title: 'The docs state which federated pictures are attached, photos included'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-18 12:27'
labels:
  - federation
  - docs
milestone: m-31
dependencies: []
references:
  - docs/media.md
  - docs/federation.md
  - packages/cms/src/federation/article.ts
priority: low
type: bug
ordinal: 376800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/media.md says a federated post attaches each upload and that decorative pictures are left out. That is true for images in a post's text and for a read cover, but not for the post's own photos: photoAttachments attaches every photo, a decorative one with no name and one from another site with no media type. That behaviour is right, since a photo post's photos are the post, the page always shows them, and leaving a decorative one out would send a photo post to Mastodon with no photo. The docs should say so, and a test should pin that a decorative photo is still attached.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/media.md and docs/federation.md say a post's photos are always attached, a decorative one with no name and a remote one with no media type, and that the decorative and remote rules apply to a cover and to images in the text
- [ ] #2 A test shows a photo the library marks decorative is attached as an Image with no name
<!-- AC:END -->
