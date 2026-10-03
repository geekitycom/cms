---
id: TASK-226
title: Feeds print body images with absolute URLs
status: To Do
assignee: []
created_date: '2026-10-03 00:59'
labels:
  - feeds
dependencies: []
references:
  - packages/cms/src/web/feed-item.ts
priority: medium
type: bug
ordinal: 241800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post body image such as ![A gull](/uploads/2026/10/gull.jpg) prints as <img src="/uploads/2026/10/gull.jpg"> in /feed/, /feed/atom/ and /feed/json/ (checked with curl while building TASK-215). A feed is read away from the site, and many readers do not resolve a relative URL against the item link or xml:base, so the image does not show. TASK-215 made photos absolute in feedItem (packages/cms/src/web/feed-item.ts, photosHtml); body HTML in FeedItem.html is not. Links (<a href>) and srcset in the body have the same problem. Any change to item serialization bumps FEED_ITEM_REVISION and refreshes the fixtures the TASK-215 notes list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A relative src, href or srcset URL in a post body is printed absolute on the site's base URL in RSS content:encoded, Atom content and JSON Feed content_html
- [ ] #2 An absolute URL, a fragment-only link and a mailto: link are left as they are
- [ ] #3 Tests assert both, for each feed format
<!-- AC:END -->
