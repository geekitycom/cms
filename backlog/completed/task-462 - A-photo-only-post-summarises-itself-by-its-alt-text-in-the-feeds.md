---
id: TASK-462
title: A photo-only post summarises itself by its alt text in the feeds
status: Done
assignee: []
created_date: '2026-10-21 00:36'
updated_date: '2026-10-22 13:52'
labels:
  - bug
  - feeds
dependencies: []
ordinal: 396800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A photo post with no title and no body (https://shll.me/2026/10/cute-dog/) carries its alt text only as an attribute inside the item HTML. The RSS `<description>` is empty, Atom has an empty `<title>` and no `<summary>`, and JSON Feed has no `summary`, so a reader that lists items by their text shows a blank item. Reviews already fall back to a generated summary; photos should do the same with their alt text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with photos and no description or body text gets its photos' alt text as the summary in RSS, Atom and JSON Feed
- [x] #2 Alt text from the media library counts, the same as alt text the post gives
- [x] #3 A post with body text or a description keeps that as its summary
- [x] #4 FEED_ITEM_REVISION moves so cached feeds revalidate
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Fall back to the photos' alt text (post's own, else the media library's), joined with ' · ', when a post has no description and its body excerpt is empty. Bump FEED_ITEM_REVISION so ETags move.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reviews keep their own summary path. Body text or a description still wins over alt text. Verified with new cases in src/web/feed-photo.test.ts for RSS, Atom and JSON Feed, plus the library alt on the second photo. The enclosure fixture's sha256 values are unchanged and only its ETags moved.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in cms 0.37.0 (6d7856e). A photo post with no description or body text is summarised by its photos' alt text, the post's own or the media library's, in RSS, Atom and JSON Feed. FEED_ITEM_REVISION moved.
<!-- SECTION:FINAL_SUMMARY:END -->
