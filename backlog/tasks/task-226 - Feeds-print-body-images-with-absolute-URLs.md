---
id: TASK-226
title: Feeds print body images with absolute URLs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 00:59'
updated_date: '2026-10-03 12:15'
labels:
  - feeds
dependencies: []
references:
  - packages/cms/src/web/feed-item.ts
  - packages/cms/src/web/absolute-urls.ts
  - packages/cms/src/web/feed-body-urls.test.ts
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
- [x] #1 A relative src, href or srcset URL in a post body is printed absolute on the site's base URL in RSS content:encoded, Atom content and JSON Feed content_html
- [x] #2 An absolute URL, a fragment-only link and a mailto: link are left as they are
- [x] #3 Tests assert both, for each feed format
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Body HTML in FeedItem.html is markdown-it output (plain <img>, no srcset from the renderer; raw HTML in a body may carry srcset). No HTML parser is a dependency; images/markup.ts already rewrites body tags by a quote-aware attribute regex for the same reason (keep the surrounding HTML byte-identical). Follow that: a tag-level rewrite in a new src/web/absolute-urls.ts.
2. Failing tests first (src/web/feed-body-urls.test.ts): a post whose body has a relative img src, a link, a raw <img srcset>, a document-relative src, plus an absolute URL, a #fragment link (footnotes) and a mailto: link; assert RSS content:encoded, Atom content and JSON content_html for each.
3. Rewrite src/href/srcset values: root-relative via absoluteUrl on the base URL (as photosHtml does), other relative references resolved against the item link (where a browser resolves them on the page); anything with a scheme and fragment-only references untouched.
4. Call it from feedItem for document.html; bump FEED_ITEM_REVISION to 8 with a history entry; refresh feed-enclosure.test.ts ETags, anonymous-pages.golden.json, feed-item.test.ts revision assertion.
5. pnpm build/test/typecheck/lint/format:check; curl /feed/, /feed/atom/, /feed/json/ on a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Body HTML in FeedItem.html is markdown-it output, so the renderer never emits srcset in feeds (decision-10 holds); a srcset only appears when a body carries raw HTML, and it is rewritten too.
Rewrite is a quote-aware text rewrite of start tags in src/web/absolute-urls.ts, not a parser: no HTML parser is a dependency, and images/markup.ts already rewrites the same body HTML this way so untouched bytes stay what the renderer wrote. Only src, href and srcset change.
Resolution: a root-relative URL goes through absoluteUrl on the base URL (same as photosHtml, keeps a base path such as /blog); any other relative reference resolves against the item link, where the browser resolves it on the page. Scheme URLs (https:, mailto:, data:), fragment-only links (footnotes) and empty values are untouched.
FEED_ITEM_REVISION 7 -> 8 with a history entry; refreshed the three ETags in feed-enclosure.test.ts (bytes and sha256 unchanged for that fixture), the RSS ETag in anonymous-pages.golden.json, and the revision assertion in feed-item.test.ts. src/images/site.test.ts pinned the old relative feed src; updated it to the absolute URL, its no-picture/no-srcset assertion stays.
Validation: pnpm build && pnpm test (3597 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Served a scratch site from packages/cms/dist on :4826 and curled /feed/, /feed/atom/, /feed/json/: img src, a href and srcset candidates absolute in content:encoded, Atom content and content_html; mailto:, https://elsewhere.example/, #fn1 and #fnref1 unchanged; source:markdown unchanged. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Feed item content now prints every relative src, href and srcset URL in a post body absolute: root-relative on the site's base URL, other relative references against the item's permalink. Absolute, fragment-only and mailto: URLs are left alone. Done in a new src/web/absolute-urls.ts (quote-aware start-tag rewrite, the same approach images/markup.ts uses) called from feedItem; FEED_ITEM_REVISION bumped to 8 and its fixtures refreshed. Verified by src/web/feed-body-urls.test.ts (both criteria in RSS, Atom and JSON Feed, plus a base URL with a path), the full build/test/typecheck/lint/format run, and curl of the three feeds on a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
