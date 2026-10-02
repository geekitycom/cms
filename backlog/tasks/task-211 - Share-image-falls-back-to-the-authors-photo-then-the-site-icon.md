---
id: TASK-211
title: 'Share image falls back to the author''s photo, then the site icon'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 07:01'
updated_date: '2026-10-02 14:27'
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
- [x] #1 A post or page with no image of its own prints og:image and twitter:image set to its author's profile photo; with no photo, the site icon; with neither, no image tags, as today
- [x] #2 The homepage and other pages about nobody in particular use the site author's photo on a solo-author site and the site icon on a several-authors site
- [x] #3 An entry's own image, and a hand-set site.avatar, still win over the fallbacks, so every page that printed an image before prints the same one
- [x] #4 The fallback image's og:image:alt is the media library's description, else the author's display name for their photo or the site title for the icon; its width and height come from the variant sidecar when one exists
- [x] #5 The default theme's JSON-LD image on a post or page is the same URL as its og:image
- [x] #6 The default theme README describes the new fallback order
- [x] #7 Sharing https://shll.me/ on Mastodon after deploy shows the author's photo in the preview card, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in page-shell.test.ts (HTTP against the packaged theme): a post with no image by a user with a photo; the same user with no photo but a site icon; neither; a solo-author homepage; a several-authors homepage; an entry with its own image and a hand-set site.avatar (unchanged); alt text and sidecar size for the photo and the icon; JSON-LD image equals og:image on a post and a page. The TASK-201 test that a page has no JSON-LD image changes: a page now takes its author's photo like a post.
2. share-image.ts: replace the single avatar/owner inputs with an ordered list of fallbacks, each a picture plus the words that describe it. The first non-empty one wins. Alt text and size keep today's rules (library description, then those words; size from the sidecar).
3. render.ts: fallbacks are site.avatar (the site author's name, else the site title), the photo of the person the page is by (context.siteAuthor from the caller, else the solo site author; their display name), then iconSetting(site) (the site title), so the icon rule stays in icons.ts.
4. jsonld.njk: drop the TASK-201 entryImage chain and print metaImage, so the JSON-LD and Open Graph cannot disagree. base.njk: update the metaImage comment.
5. oEmbed passes no fallbacks (TASK-205).
6. Theme README: the picture paragraph and the JSON-LD bullet.
7. Gates: build, test, typecheck, lint, format:check. Curl a scratch site: solo homepage, a post by a user with a photo, a several-authors homepage, a site with an icon only.
8. Ship as fix(cms). AC#7 needs a deploy to shll.me and a real Mastodon share; left open.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The site icon fallback has no admin field yet. TASK-212 adds Site icon to Settings > General. TASK-211 does not depend on it: once TASK-212 sets an icon, the fallback uses it with no further change.

Built as planned. shareImage() in share-image.ts now takes an ordered `fallbacks` list of { url, describedAs } in place of avatar/owner; the first that names a picture wins, and the alt and size rules are unchanged (library description, else describedAs; size from the sidecar). render.ts passes site.avatar (site author's name, else site title), the photo of the person the page is by (context.siteAuthor, else the solo site author; their display name), then iconSetting(site) (site title). oEmbed passes [] so its thumbnail is still only the post's own picture (TASK-205). jsonld.njk drops the TASK-201 entryImage chain and prints metaImage, so a page (not only a post) now carries the fallback image in its Article node; the TASK-201 test asserting a page had no JSON-LD image was changed to match.

Evidence: new describe block 'the share image falls back to a photo, then the icon (TASK-211)' in page-shell.test.ts failed before the change (og:image undefined, expected the photo or icon URL) and passes after. Gates: pnpm build && pnpm test (3119 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Scratch sites curled over HTTP: solo author with photo prints the photo on / and a post with alt 'Ada Lovelace' and width/height 400; several-authors site prints the icon on / (alt 'Scratch', 512x512) and Grace's photo on her post (alt 'Grace Hopper'); solo author with no photo prints the icon. JSON-LD image equalled og:image on every entry checked.

AC#7 is open: it needs a deploy to shll.me and a real Mastodon share, which this run does not have. The task stays In Progress until that check is done.

AC#7 verified 2026-10-02 after 0.15.0 deployed to shll.me: curl https://shll.me/ prints og:image and twitter:image https://shll.me/uploads/2026/09/andrew-004.jpg with alt 'Andrew Shell'. Sharing https://shll.me/ from @andrewshell on me.dm rendered a preview card titled Shll.me with the author's photo as its image.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The share image (og:image, twitter:image) now falls back from the entry's own image and a hand-set site.avatar to the photo of the person the page is by, then the site icon, and the default theme's JSON-LD prints that same image. Verified by new page-shell tests (failing before, passing after), the full gate suite, curl against scratch sites, and a real Mastodon share of https://shll.me/ after the 0.15.0 deploy, whose preview card showed the author's photo.
<!-- SECTION:FINAL_SUMMARY:END -->
