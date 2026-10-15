---
id: TASK-394
title: A read post can carry a book cover on its citation
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 20:24'
updated_date: '2026-10-15 01:41'
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
- [x] #1 A read citation stores an optional cover image (an upload or URL with alt text) alongside name, author, URL and ISBN
- [x] #2 The read editor in the admin lets the author choose, change and remove the cover
- [x] #3 A read post with a cover and no post photos is discovered as Read, and its kicker says Read
- [x] #4 The rendered read line includes the cover as an img.u-photo inside the p-read-of h-cite, with its alt text, and the entry has no u-photo of its own from it
- [x] #5 The default theme shows the cover as a thumbnail no wider than its natural size beside the read line, never stretched to the column width
- [x] #6 Feeds, ActivityPub and Micropub source reflect the cover on the citation rather than as an entry photo
- [x] #7 Docs describing read posts mention the cover
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. read.ts: ReadOf gains optional photo (Photo: url + alt), parsed from read-of.photo (bare address or {url, alt}) and written back by readWorkFrontMatter. readLine prints it as img.u-photo inside the p-read-of h-cite, wrapped in span.read-cover; alt from the post, else the media library; absolute when given a base URL.
2. read-form.ts: ReadOfForm gains photo and photoAlt (read-of-photo, read-of-photo-alt). resolveRead checks the address is an upload or https address; write.ts checks an upload is an image in the media library (shared with resolvePhotos). Micropub read-of accepts photo (string or {value, alt}); readCite emits it the same way, absolute.
3. Editor: Cover address (media library datalist) and Cover alt text fields in the Read section; empty the address to remove it. editor-layout filled() counts them.
4. Context: read.line run through siteImageMarkup so uploads get variants; feed-item and the federated Note/Article pass baseUrl (and the alt library) so the cover is absolute; no attachment, no entry photo.
5. Theme CSS: .read-cover floated beside the read line, max 8rem, never upscaled.
6. Tests per criterion first (read.test, read-form/post-fields, post-type, context/listing, feed-item, federation, micropub source, editor), then docs (micropub.md, theme docs).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Representation choices:
- Front matter: read-of.photo, a bare address or { url, alt } (mf2's h-cite photo). Parsed by photo.ts photoOf (now exported); alt falls back to the media library like a post photo.
- Page and listing: readLine prints span.read-cover > img.u-photo as the first child of span.p-read-of.h-cite; the page context runs the line through siteImageMarkup, so an upload is a responsive <picture> with natural width/height. The entry gets no u-photo (mf2 parse checked in src/web/read-cover.test.ts).
- RSS/Atom/JSON: same read line with an absolute src at the top of the item HTML; not the item's image. summary (TASK-233) is unchanged: the cover adds no words.
- ActivityPub: same img in content (absolute); deliberately no Image attachment, since an attachment is the post's own media. Mastodon strips <img> from content, so Mastodon users will not see the cover; other servers keep the HTML.
- Micropub: read-of h-cite accepts photo as an address or { value, alt }; q=source returns it the same way, absolute.
- Editor: Cover and Cover alt text fields in the Read section, sharing the photo uploads datalist; empty Cover removes it. An upload must be an image in the media library (isLibraryImage, shared with resolvePhotos), else refused on editor-read-of-photo.
- Theme: .read-line is flow-root; .read-cover floats inline-start; img is width/height auto, max 6rem x 8rem, so it never upscales. sizes stays 100vw from the variants pipeline (covers are small, so the largest variant is the original).
- No new data files written.
Validation: pnpm build, test (cms 6166 pass), typecheck, lint, format:check all pass. Live: scratch site via geekity init, signed in, created a read post with cover /uploads/2026/10/peregrine.jpg (269x425) through POST /admin/posts/new; file got read-of.photo {url, alt}; editor reload shows both fields; curl of post page (kicker Read, picture width=269 height=425 inside h-cite, no post-photos), / listing, /feed/json/ (absolute img, image None) and AP Note (content has absolute img, attachment None). Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A read citation now carries an optional cover (read-of.photo: upload or https address with alt). The admin Read section gets Cover and Cover alt text fields (choose, change, remove; uploads must be library images). The read line prints the cover as span.read-cover > img.u-photo inside the p-read-of h-cite, so the post stays a Read and the entry has no u-photo; the default theme floats it as a thumbnail capped at 6rem x 8rem and never upscaled, as a responsive picture for uploads. Feeds and the federated Note carry the same img with an absolute src (no item image, no attachment); Micropub read-of accepts and q=source returns photo on the h-cite. Docs updated (page-shell, template-context, micropub). Verified by new tests (read.test, read-form.test, post-type, posts editor, read-cover web/mf2/feeds, federation, indiebookclub q=source, theme stylesheet), the full build/test/typecheck/lint/format run, and a live scratch site with a 269x425 cover set through the admin and curled on the page, listing, JSON feed and ActivityPub Note.
<!-- SECTION:FINAL_SUMMARY:END -->
