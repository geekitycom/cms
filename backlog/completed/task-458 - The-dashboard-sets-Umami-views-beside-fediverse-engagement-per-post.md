---
id: TASK-458
title: The dashboard sets Umami views beside fediverse engagement per post
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 04:43'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-456
  - TASK-448
priority: medium
ordinal: 395800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Combine Umami views per post with the core per-post engagement totals (TASK-448) to show posts read widely but little reacted to, and the other way round, plus each recent post traffic in its first 7 days.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A widget lists recent posts with their views and engagement total side by side, in two orders: most read and most engaged (the dashboard has no client script for re-sorting a widget)
- [x] #2 Each post published in the last 30 days shows its views over its first 7 days
- [x] #3 Posts with no Umami data show as no data, not zero
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (feat(cms)): PostsService.publishedSince({ since }) -> PublishedPost[] {permalink, title, editUrl, published}, newest first, the posts a reader can open dated at or after since (store.listPostsPublishedSince). Tested through a plugin widget in posts-by-path.test.ts; documented in docs/plugins.md.
2. Client: stats(range, { path }) sends Umami 3's path filter (path=eq.<path>). Fake Umami answers a filtered stats from fake.data.pathViews.
3. Plugin src/recent.ts recentPostsWidget(client, sources, now): full width, after devices + right now, refresh 1800 s. Recent = posts published in the last 30 days (fixed window: AC #2 names 30 days and each listed post's whole life fits in it). Views since publishing from one expandedMetrics('path') read (500 rows) over those days, mapped to posts with byPath (variants add up); engagement total from @geekity/cms/engagement posts({ since }) (missing -> 0).
4. Either order: widgets have no client script and no request query, so the card shows a 'Most read' and a 'Most engaged' table, ten rows each, columns Post | Views | Engaged | Week 1 (short headers so the post title keeps room at 390 px). AC #1 reworded.
5. Week 1: per shown post with views, stats over [published, published + 7 days] filtered by its path (base directory included), four at a time; a finished week is kept in memory; an unfinished one reads 'N so far'.
6. No data rule: a post Umami recorded no view of since it was published shows 'no data' in Views and Week 1 and gets no Week 1 request; once it has views, a Week 1 of 0 is a real 0.
7. Tests first per AC against the fake Umami (test/recent.test.ts, dashboard order + end-to-end card), README, full check chain, headless Chromium screenshots at 1280 and 390.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core: no core service listed recent posts, so @geekity/cms/posts gained publishedSince({ since }) over store.listPostsPublishedSince (public or unlisted, due, not draft/trashed), newest first, PublishedPost {permalink, title, editUrl, published}. byPath unchanged.
Window: fixed 30 days (midnight of the first day in the site time zone), not the dashboard period: AC #2 names 30 days, and since every listed post was published inside the window, Views and Engaged are 'since published'.
Sorting: the dashboard draws widgets without client script and passes widgets only {site, timezone, period}, so the card shows both orders as two tables (paragraph heading + table, caption names the order). AC #1 reworded through the CLI to say so.
Week 1: Umami 3 stats with path=eq.<base dir><permalink> (FILTER_COLUMNS has path -> url_path; parseFilterValue defaults to equals). Up to 20 posts shown, only those with views are asked, four at a time; a finished week is cached in the widget closure, so after the first load only posts younger than a week are asked again. Path variants (no trailing slash, query) count in Views via byPath but not in Week 1, which asks for the canonical path.
No data rule: no path row with views over the 30 days -> 'no data' in Views and Week 1 (and no request); 0 is shown only for a post Umami has views for. Engaged has no 'no data': the core counts it, so absent means 0.
Layout: 4 columns crushed titles at 390 px with 'Engagement'/'First 7 days' headers; 'Engaged'/'Week 1' leave the title column readable. Page scrollWidth 390 at 390 px, 1280 at 1280.
Verification: test/recent.test.ts (9 tests, fake Umami), test/dashboard.test.ts (order/full width + end-to-end card through the core services), client path-filter test, core posts-by-path.test.ts (2 new). pnpm build, test (cms 6518, umami 106), test:11ty, typecheck, lint, format:check all exit 0. Headless Chromium screenshots of a seeded dashboard (6 posts, approved comments, fake Umami) at 1280 and 390 px checked.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the full-width 'Umami: recent posts' dashboard card: posts published in the last 30 days in a Most read and a Most engaged table (ten each) with Views (Umami, since published), Engaged (core engagement total) and Week 1 (Umami views over the first 7 days after publishing, 'N so far' until the week ends). A post Umami recorded no view of shows 'no data' rather than 0. New core service method host.use('@geekity/cms/posts').publishedSince({ since }) (docs/plugins.md); the Umami client's stats takes a path filter. Verified with fake-Umami widget and dashboard tests, core service tests, the full build/test/typecheck/lint/format chain, and headless Chromium screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
