---
id: TASK-457
title: The dashboard shows the Umami audience and visitors right now
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 04:23'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-454
  - TASK-444
priority: medium
ordinal: 394800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Countries, browsers and devices for the last 7 days as ranked lists, and the number of visitors on the site right now from the Umami realtime endpoint.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Countries, browsers and devices each list their top five with share of visitors, as ranked lists rather than pie charts
- [x] #2 Visitors right now shows as a stat with a short refresh interval, separate from the 7-day lists
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (feat(cms)): ranked block takes an optional format ('number' | 'percent' | 'duration', as stats do) for every item's value; blocks.ts validates and writes it, blocks.test.ts covers it, docs/plugins.md and the PluginBlock type describe it.
2. Plugin src/audience.ts: countries, browsers and devices widgets (half width, 300 s), following context.period via period.ts. Each reads stats(range).current.visitors and metrics(type, range, {limit: 5}) in parallel and draws a ranked list of share of visitors (count / visitors * 100) with format percent. Umami counts distinct sessions per value and a session has one country, browser and device, so shares of one type add up to at most 100%. Countries named with Intl.DisplayNames('en', region), code kept when unknown; browsers and devices mapped from Umami identifiers to Umami's own labels, others kept as is; an empty value shows Unknown. No visitors says so.
3. Plugin visitors-right-now widget (half, refreshSeconds 30): client.active() as a stat with a note that Umami counts the last 5 minutes.
4. Order: traffic(full), pages+referrers, countries+browsers, devices+right now, so no half card sits alone.
5. Tests first: unit tests with the fake Umami (test/audience.test.ts), dashboard test for order/widths; README and package description updated.
6. Verify: full build/test/typecheck/lint/format, headless Chromium screenshots of /admin at 1280 and 390 px against the fake Umami.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core: the ranked block takes an optional block-level format (number | percent | duration), written as stats write theirs (blocks.ts isValueFormat/formatted; StatFormat renamed ValueFormat). Unknown format draws the empty block. Block-level rather than per item: a list in mixed formats has no use.
Plugin: src/audience.ts audienceWidget(client, 'country'|'browser'|'device') and visitorsNowWidget(client). Shares are metrics count / stats().current.visitors * 100 for the same range; Umami counts distinct sessions per value and a session has one country, browser and device, so one list adds to at most 100%. Countries via Intl.DisplayNames('en', region, fallback code), invalid codes kept; browser and device labels copied from Umami's own BROWSERS/DEVICES names; empty value (null from Umami) is Unknown. Visitors right now: active() stat, refreshSeconds 30, paragraph says Umami counts the last 5 minutes.
Layout: traffic(full), pages+referrers, countries+browsers, devices+visitors right now - every half card paired.
Validation: pnpm build, test (cms 6516, plugin-umami 94, others pass), test:11ty, typecheck, lint, format:check all pass. Headless Chromium screenshots of /admin against the fake Umami at 1280 and 390 px (scratchpad shot457): cards paired at 1280, stacked at 390, no horizontal scroll.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Countries, browsers and devices cards list the top five values as a share of the period's visitors (ranked lists, percent format), following the dashboard period; a visitors right now card shows Umami's active count as a stat refreshed every 30 seconds. Core gained an optional format on the ranked block. Verified against the fake Umami: test/audience.test.ts (widget loads) and test/dashboard.test.ts (cards drawn on /admin, order and widths, 30 s refresh), full gate suite green, and headless Chromium screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
