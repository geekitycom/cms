---
id: TASK-442
title: The admin draws charts as server-rendered SVG from declarative blocks
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 22:02'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies: []
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
priority: medium
ordinal: 379800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, dashboard widgets return declarative blocks and the core writes the markup. Build the blocks and their drawing: stats with an optional change from the previous period, a time series of one or more named series over days, a ranked list (label, value, optional link), a calendar of counts per day, a table and a paragraph. Charts are SVG drawn on the server with DaisyUI colour tokens, and the admin ships no chart library or client chart code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each block type draws from plain data, and invalid input (no points, negative or non-numeric values) draws an empty state instead of throwing
- [x] #2 A time series with two series draws both with a legend, labelled axes and readable day ticks for 7 and 30 days
- [x] #3 Every chart has a text or table equivalent a screen reader reaches, and colour is never the only way to tell series apart
- [x] #4 Charts follow the admin light and dark themes through DaisyUI tokens, with no hard-coded colours
- [x] #5 A change from the previous period shows its sign and direction in text, not only in colour
- [x] #6 Blocks are covered by tests that assert on the drawn output
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Widen PluginScreenBlock in src/plugin.ts into one shared block vocabulary: paragraph and table as today, plus stats (label, value, optional previous and better), timeSeries (caption, days, named series of values), ranked (caption, items of label, value, optional href) and calendar (caption, days of day and count).
2. Add src/admin/blocks.ts: drawBlock(unknown) parses a block at the plugin boundary and returns a view model with a kind (empty on invalid input) and every coordinate, tick, legend entry and text equivalent precomputed. Registered as the admin Nunjucks filter 'drawn'.
3. Add admin/components/blocks.njk with a block(view) macro that writes the markup: DaisyUI stats with signed change text and an aria-hidden arrow, SVG time series with gridlines, y and day ticks, a legend whose keys repeat each series' dash pattern and marker shape, a ranked list as an ol with SVG bars, a calendar heatmap with a Less/More key, and a details table for every chart. Colours only through DaisyUI token classes (stroke-primary, fill-base-content/10 ...).
4. Draw plugin screen cards through the macro so the blocks run on a real page.
5. Tests first (tdd): blocks.test.ts renders each block through the admin environment and asserts on the drawn markup for every criterion; plugins.test.ts proves a screen draws a chart.
6. Document the blocks in docs/plugins.md, then run build, test, test:11ty, typecheck, lint, format:check, and look at the compiled CSS for the token classes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/admin/blocks.ts (drawBlock: checks plugin data at the boundary and precomputes a DrawnBlock view model, registered as the admin Nunjucks filter 'drawn') and admin/components/blocks.njk (block(data) macro). PluginScreenBlock in src/plugin.ts is now the one shared vocabulary: paragraph, table, stats, timeSeries, ranked, calendar; plugin screens draw through the macro, so the blocks run on a real page (plugins.test.ts).
Decisions: a time series needs consecutive days and at most four series (four DaisyUI tokens primary/secondary/accent/info, each paired with its own dash and marker shape); a fifth series draws the empty state rather than a cycled colour. A calendar spans at most 366 days. Ranked links keep only root-relative paths and http(s) addresses. Stats carry previous and better ('up' default, 'down' for e.g. bounce rate) and say the change as '+20%, up from 100' with an aria-hidden arrow. Hover titles per day/cell give native tooltips with no script. Each chart has an sr-only description the SVG is labelled by, and a 'Show the numbers' details table.
Used div, not figure: DaisyUI's .card figure rule centres and shrink-wraps a figure inside a card. Classes are written out in full (styles.test reads them); series colour comes from a tinted(index) macro that opens a <g>. list-screens.test now treats components/blocks.njk tables as in a card, since blocks are only drawn in cards.
HOST_API_VERSION is unchanged; decision-59 bumps it when widgets land (TASK-444).
Validation: pnpm build, pnpm test (6379 cms tests pass, all packages green), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Rendered every block in light and dark with the compiled admin.css in headless Chrome and checked the screenshots.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added server-rendered blocks for the admin: stats with a worded change from the previous period, multi-series time series SVG with legend, axes and day ticks, ranked list, calendar heatmap, table and paragraph. drawBlock (src/admin/blocks.ts) validates plugin data and draws invalid input as 'No data to show.'; components/blocks.njk writes the markup with DaisyUI token classes only. PluginScreenBlock now carries all six kinds and plugin screens draw them. Verified with blocks.test.ts (42 tests on drawn output), plugins.test.ts, the full build/test/11ty/typecheck/lint/format run, and light/dark screenshots.
<!-- SECTION:FINAL_SUMMARY:END -->
