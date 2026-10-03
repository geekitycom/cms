---
id: TASK-215
title: Feeds carry a post's photos
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 16:22'
updated_date: '2026-10-03 00:58'
labels:
  - feeds
  - micropub
dependencies: []
priority: medium
type: bug
ordinal: 231800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-166 added the photo front matter key (photosOf/photoAlt in packages/cms/src/content/photo.ts). The RSS, Atom and JSON feeds do not include photos, so a photo-only post reads empty in a feed reader. Each feed format should carry the photos the way it carries body images (JSON Feed image/attachments, an img in RSS/Atom content), with alt text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A photo-only post shows its photos, with alt text, in the RSS, Atom and JSON feed items
- [x] #2 Tests assert the photos appear in each feed format
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: FeedItem.html becomes the photos then the body (one <figure><img src alt></figure> per photo, src absolute on baseUrl, alt from photoAlt with the media library, '' when undescribed), and FeedItem.image is the JSON Feed main image: the post's own image front matter, else its first photo, absolute.
2. FeedSource / FeedItemContext gain altTexts (AltTextLibrary, type-only import); the feed route passes readAltTexts(contentDir).
3. RSS content:encoded and Atom content print item.html unchanged in shape, so they carry the photos; JSON Feed content_html likewise, plus image. No photo enclosures or attachments.
4. Bump FEED_ITEM_REVISION to 7 so cached readers of an existing photo post get the new bytes; add each photo's library alt to the feed fingerprint so a media-library alt edit moves the ETag. Refresh the TASK-213 byte-stability fixture ETags (bodies of photo-less feeds must stay byte-identical).
5. Tests first (feed-photo.test.ts through cms.app.request): photo-only post in /feed/, /feed/atom/, /feed/json/ shows absolute img with alt (own and library); JSON image; a post with recording and photos keeps its enclosure and attachments unchanged.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions per format:
- RSS content:encoded, Atom content and JSON Feed content_html all print the photos before the body, as the page does: one <figure><img src alt></figure> per photo, the original upload (decision-10, no variants), src absolute on baseUrl, alt from photoAlt (post's own, else the media library's, else empty). Done once in feedItem (FeedItem.html), so the three formats cannot disagree.
- JSON Feed item gains image: the post's own image front matter, else its first photo, absolute. This also gives a post that names an image (and no photos) a JSON image for the first time; the XML formats have no such field.
- No enclosure or attachment for photos. A post with a recording and photos keeps the recording as its only RSS enclosure, Atom rel=enclosure link and JSON attachment (tested).
- FEED_ITEM_REVISION 6 -> 7, so a reader holding a cached photo post gets the new bytes instead of a 304. The library alt of each photo joins the feed fingerprint, so editing a photo's alt in the media library moves the ETag (tested).
- Fixtures refreshed: TASK-213 byte-stability ETags in feed-enclosure.test.ts (bodies of photo-less feeds still byte-identical, sha256 unchanged) and the RSS ETag in __testing__/anonymous-pages.golden.json (regenerated with GEEKITY_UPDATE_GOLDEN=1, the only line that moved).
- FeedSource/FeedItemContext take altTexts (type-only import of AltTextLibrary, so content/photo.ts and feed modules pull in no image encoder); the feed route passes readAltTexts(contentDir).
- Found, not fixed (out of scope): body images in feed content are NOT absolutized. A post with ![A gull](/uploads/2026/10/gull.jpg) prints <img src="/uploads/2026/10/gull.jpg"> in /feed/ (curl-verified). Only photos are absolute after this task.
Validation: pnpm build, pnpm test (3542 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Curl of a running server (createCms on a temp content dir with a photo-only post and a media.json entry): /feed/ content:encoded, /feed/atom/ content and /feed/json/ content_html each carry both photos with absolute src and alt text (own and library); JSON image is the first photo; no enclosure or attachments. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Feeds now carry a post's photos. FeedItem.html prints each photo as <figure><img src alt></figure> (absolute original, alt from the post or the media library) before the body, so RSS content:encoded, Atom content and JSON Feed content_html all show a photo-only post's photos; JSON Feed also names the item's image (own image, else first photo). Photos are never enclosures or attachments, so a recording post with photos is unchanged there. FEED_ITEM_REVISION bumped to 7 and library alts joined the feed fingerprint so cached readers refetch. README Feeds section documents it. Verified by feed-photo.test.ts (8 tests through the HTTP app, written failing first), the full pnpm build/test/typecheck/lint/format:check run, and curl of /feed/, /feed/atom/ and /feed/json/ on a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
