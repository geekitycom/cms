---
id: TASK-211
title: 'Share image falls back to the author''s photo, then the site icon'
status: To Do
assignee: []
created_date: '2026-10-02 07:01'
updated_date: '2026-10-02 07:03'
labels:
  - theme
  - seo
  - open-graph
dependencies: []
references:
  - packages/cms/src/web/share-image.ts
  - packages/cms/src/web/render.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/partials/jsonld.njk
  - backlog/decisions
priority: medium
type: bug
ordinal: 227800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The picture a shared link shows (og:image, twitter:image, TASK-146) is the entry's own `image`, else `site.avatar`. Decision-14 removed the avatar setting from the admin, so `site.avatar` is only ever set by hand in site.json, and every page without its own image has no og:image. Seen on 2026-10-02: a me.dm toot linking https://shll.me/ showed a preview card with a blank placeholder where the picture goes, even though the author has a profile photo. The default theme's JSON-LD already falls back further (TASK-201: own image, site avatar, author's photo, site icon), so Google and Mastodon see different pictures for the same page. Make the share image fall back in that same order: the entry's own image, else a hand-set `site.avatar`, else the photo of the person the page is by (the post's writer, or the site author on a solo-author site's homepage and other pages about nobody in particular), else the site icon. Then the JSON-LD reads that one share image instead of repeating the order. oEmbed thumbnails stay as they are: they show only the post's own picture by design (TASK-205).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post or page with no image of its own prints og:image and twitter:image set to its author's profile photo; with no photo, the site icon; with neither, no image tags, as today
- [ ] #2 The homepage and other pages about nobody in particular use the site author's photo on a solo-author site and the site icon on a several-authors site
- [ ] #3 An entry's own image, and a hand-set site.avatar, still win over the fallbacks, so every page that printed an image before prints the same one
- [ ] #4 The fallback image's og:image:alt is the media library's description, else the author's display name for their photo or the site title for the icon; its width and height come from the variant sidecar when one exists
- [ ] #5 The default theme's JSON-LD image on a post or page is the same URL as its og:image
- [ ] #6 The default theme README describes the new fallback order
- [ ] #7 Sharing https://shll.me/ on Mastodon after deploy shows the author's photo in the preview card, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first (share-image.test.ts and page-shell.test.ts): a post with no image by a user with a photo; the same user with no photo but a site icon; neither; a solo-author homepage; a several-authors homepage; an entry with its own image and a hand-set site.avatar (unchanged); alt text and sidecar size for the photo and the icon; JSON-LD image equals og:image on a post and a page.
2. share-image.ts: replace the single `avatar`/`owner` inputs with an ordered list of fallbacks, each a picture plus the words that describe it: `site.avatar` (the site author's name), the page author's photo (their display name), then the site icon (the site title). The first non-empty one wins. Alt text and size keep today's rules (library description, then those words; size from the sidecar).
3. render.ts: pass the page author as the person the page is by (`context.siteAuthor` from the caller, else the solo site author), plus `site.icon` as the last fallback.
4. jsonld.njk: drop the TASK-201 `entryImage` chain and print `metaImage`, so the JSON-LD and Open Graph cannot disagree.
5. Leave oEmbed alone: it passes no fallbacks.
6. Theme README: update the "picture" paragraph (around line 712) and the JSON-LD bullet.
7. Gates: build, test, typecheck, lint, format:check. Curl a scratch site: solo homepage, a post by a user with a photo, a several-authors homepage, a site with an icon only.
8. Ship as fix(cms). After deploy, share https://shll.me/ on me.dm and read the card through the API.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The site icon fallback has no admin field yet. TASK-212 adds Site icon to Settings > General. TASK-211 does not depend on it: once TASK-212 sets an icon, the fallback uses it with no further change.
<!-- SECTION:NOTES:END -->
