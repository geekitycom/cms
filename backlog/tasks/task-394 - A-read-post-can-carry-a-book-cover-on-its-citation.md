---
id: TASK-394
title: A read post can carry a book cover on its citation
status: To Do
assignee: []
created_date: '2026-10-13 20:24'
updated_date: '2026-10-15 00:56'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/src/content/read.ts
  - packages/cms/src/content/post-type.ts
  - packages/cms/themes/default/partials/photos.njk
  - 'https://shll.me/2026/10/miss-peregrine-s-home-for-peculiar-children/'
  - 'https://indieweb.org/read'
priority: medium
type: feature
ordinal: 350800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A read post (read-of + read-status) has nowhere to put the book's cover, so the only way to show one is to add it as a post photo. That has two bad effects, seen on https://shll.me/2026/10/miss-peregrine-s-home-for-peculiar-children/ :

1. Post Type Discovery (packages/cms/src/content/post-type.ts) checks photo before read, so the post is typed and labelled Photo instead of Read. The order is deliberate (extension types only claim what the spec would call a note or article) and should not change.
2. The default theme stretches every post photo to the column width (.post-photo img { width: 100% }), so a 269x425 cover is upscaled into a blurry hero above a one-line review.

The cover describes the book, not the post. In microformats it belongs on the citation as a u-photo inside the p-read-of h-cite, not as the entry's own u-photo. The read citation (packages/cms/src/content/read.ts) should gain an optional cover image that the read editor sets and the theme renders as a small thumbnail beside the read line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A read citation stores an optional cover image (an upload or URL with alt text) alongside name, author, URL and ISBN
- [ ] #2 The read editor in the admin lets the author choose, change and remove the cover
- [ ] #3 A read post with a cover and no post photos is discovered as Read, and its kicker says Read
- [ ] #4 The rendered read line includes the cover as an img.u-photo inside the p-read-of h-cite, with its alt text, and the entry has no u-photo of its own from it
- [ ] #5 The default theme shows the cover as a thumbnail no wider than its natural size beside the read line, never stretched to the column width
- [ ] #6 Feeds, ActivityPub and Micropub source reflect the cover on the citation rather than as an entry photo
- [ ] #7 Docs describing read posts mention the cover
<!-- AC:END -->
