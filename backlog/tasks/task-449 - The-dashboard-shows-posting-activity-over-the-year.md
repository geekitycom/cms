---
id: TASK-449
title: The dashboard shows posting activity over the year
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-21 00:27'
labels:
  - dashboard
  - content
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 386800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A calendar of posts per day over the last year, and posts per month split by kind (note, article, photo, review, checkin and the rest), so the owner sees their rhythm.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A calendar block shows published posts per day for the last 52 weeks, with a text equivalent
- [x] #2 Posts per month for the last 12 months show split by kind
- [x] #3 Drafts, trashed and scheduled future posts are not counted, and days follow the site time zone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: CatalogReader.listPostsPublishedSince(since) on the content index — posts that are served (not draft, not trashed, already due, public or unlisted) dated at or after an instant, oldest first. Test in the sqlite store tests.
2. Block: a new declarative 'bars' block {caption, groups: labels, series ≤4 {name, values}} drawn in src/admin/blocks.ts + components/blocks.njk as stacked bars in server SVG: DaisyUI token colours, a texture per series (solid, hatch, dots, cross-hatch) that the legend repeats, a total above each bar, a hover title per bar, a description and a table of the numbers; empty state on bad input. Tests in blocks.test.ts first.
3. Widget: src/admin/widget-posting.ts, id posting-activity, title 'Posting activity', full width (the calendar is ~960px wide), after top-posts in CORE_WIDGETS. Blocks: a calendar of published posts per day for the last 52 weeks (364 days ending today in the site time zone) and bars of posts per month for the last 12 months split by kind. Kind = Post Type Discovery (postTypeOf) refined to episode (enclosure) and check-in (location data file) for notes, articles and photos, as the editor does; the three busiest kinds keep their own series and the rest fold into Other so there are never more than four. Days and months in the site time zone. The 7/30 period is ignored. A year with no posts draws a sentence instead of empty charts.
4. Tests first in src/admin/widget-posting.test.ts over GET /admin: per-day calendar and text equivalent, month split by kind, drafts/trashed/scheduled excluded, time zone day boundary, Other folding.
5. Docs: docs/plugins.md Blocks gains bars; docs/admin.md dashboard line.
6. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; headless Chromium screenshots of /admin at 1280 and 390 px, light and dark.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: CatalogReader.listPostsPublishedSince(since) (src/content/store.ts, sqlite/catalog.ts): type post, SERVED_CLAUSE (not draft, not trashed, due, public or unlisted), date_sort >= since, oldest first. New declarative 'bars' block in plugin.ts/blocks.ts/blocks.njk: {caption, groups ≤24, groupName?, series ≤4}, stacked bars as server SVG with DaisyUI token colours plus a texture per series (solid, 45° hatch, dots, -45° hatch, drawn in the surface colour) that the legend repeats, a total above each bar, a hover title per segment, an sr-only description and a 'Show the numbers' table with a Total column, empty state on bad input. timeSeries and bars share namedSeries/valueAxis helpers. Core widget src/admin/widget-posting.ts (id posting-activity, 'Posting activity', full width, refresh 900 s), last in CORE_WIDGETS after top-posts: a calendar of the 364 days ending today and bars of the 12 months ending this month, both in the site time zone.
Decisions: the widget ignores the dashboard's 7/30 period (it is about the year); the board still caches it per period. Kind is Post Type Discovery (postTypeOf) with a note, article or photo counted as an episode (enclosure) or check-in (data/locations.json), as the editor's discoveredKind does. Four kinds or fewer each get a series; more keeps the three busiest and folds the rest into Other, drawn in a fixed kind order so a kind keeps its colour. Months are labelled 'Nov 2025'; on a 12-bar chart every other label is drawn and the table carries all. No posts in the window draws a sentence instead of charts. Full width because the calendar is ~965 px wide.
Validation: pnpm build, test (cms 6468 pass), test:11ty, typecheck, lint, format:check all pass. New tests: store.test.ts (listPostsPublishedSince), blocks.test.ts (bars: invalid input, segments, labels, totals, texture and legend, description and table, single series, all-zero, token colours, fifth series), widget-posting.test.ts over GET /admin (calendar per day + text, month split by kind, Other folding, check-ins, drafts/trashed/scheduled excluded, Chicago day and month boundaries, period ignored, empty year). Scratch site with 268 generated posts on :3463, headless Chromium at 1280 and 390 px in light and dark: chart readable in both themes, document scrollWidth equals the viewport at 390.
Seen, out of scope: the calendar block (TASK-442) is drawn at 1.25x, ~965 px, so in a full card at 1280 px it scrolls sideways a little inside its card and on a phone it opens at the oldest months.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The dashboard has a Posting activity card (full width, after Top posts): a calendar of published posts per day for the last 52 weeks and stacked bars of posts per month for the last 12 months split by kind (three busiest kinds plus Other), both in the site time zone, each with a description and a table of numbers. Drafts, trashed and scheduled posts are left out through a new content-index query, listPostsPublishedSince. Bars are a new declarative block plugins can use too, documented in docs/plugins.md, with a texture per series so colour is not the only cue. Verified with new store, block and GET /admin tests, the full build/test/typecheck/lint/format suite, and headless Chromium screenshots at 1280 and 390 px in light and dark.
<!-- SECTION:FINAL_SUMMARY:END -->
