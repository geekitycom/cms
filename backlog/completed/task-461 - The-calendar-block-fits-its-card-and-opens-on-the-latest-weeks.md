---
id: TASK-461
title: The calendar block fits its card and opens on the latest weeks
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 00:29'
updated_date: '2026-10-21 00:37'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies:
  - TASK-449
priority: medium
ordinal: 398800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-449 found the TASK-442 calendar block is drawn at 1.25x, about 965 px wide. In a full card at 1280 px it scrolls sideways a little inside the card, and on a phone it opens on the oldest months, so the recent weeks are off screen. The posting-activity widget uses it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At 1280 px a 52-week calendar in a full-width dashboard card shows every week with no scroll inside the card
- [x] #2 On a 390 px phone the latest weeks are visible when the page loads, whether the calendar scales down or scrolls with its scroll position at the newest end, and the page itself does not scroll sideways
- [x] #3 Day cells stay large enough to read their shading, and the text equivalent is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test first in blocks.test.ts: a 52-week calendar's scroller is a reversed flex row and its svg shrinks to the card down to a 40rem floor; a short calendar keeps its own size.
2. blocks.njk calendar: scroller 'flex flex-row-reverse overflow-x-auto' so its scroll origin is the newest end; svg keeps width/height attrs at 1.25x as its largest size, class 'mr-auto h-auto shrink-0' plus 'max-w-full min-w-160' when that size is over 640 px. No script.
3. Measure in headless Chromium on a scratch site (268 posts) and on a plugin screen drawing a 364-day calendar, at 1280, 800 and 390 px, light and dark.
4. Full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: no-JS fix in admin/components/blocks.njk. The calendar's scroller is a reversed flex row, so Chromium/WebKit/Gecko put its scroll origin at the right: when the calendar is wider than the card, the page opens on the newest weeks (scrollLeft 0 is the newest end). The svg keeps width/height at 1.25x as its natural size and gets 'h-auto max-w-full min-w-160' when that size is over 640 px, so it shrinks to the card but never under 40rem (cells ~10 px); a shorter calendar is drawn at its own size (no floor, no shrink). 'mr-auto' keeps a calendar that fits at the card's left.
Measured (headless Chromium, scratch site of 268 posts on :3463 and a test plugin screen drawing 364 days): 1280 px dashboard card scroller scrollWidth 897 = clientWidth 897, svg 897 px, cells 13.9 px, first and last day visible; 800 px: 689 = 689, cells 10.7 px; 390 px: scroller 640 vs 310, scrollLeft 0, latest day (20 Oct 2026) visible, document scrollWidth 390 = viewport, cells 9.9 px. Plugin screen numbers identical. Light and dark screenshots checked. Description sentence and Show the numbers table untouched (existing calendar tests pass unchanged).
Validation: pnpm build, test (cms 6470 pass), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The calendar block now fits its card and opens on the newest weeks, with no script. Its svg shrinks to the card width (max 1.25x, floor 40rem so cells stay ~10 px or larger), and its scroller is a reversed flex row so, when a phone is narrower than the floor, the scroll starts at the newest end. Verified with two new blocks.test.ts cases, the full build/test/typecheck/lint/format suite, and headless Chromium measurements on the dashboard and a plugin screen: at 1280 px scrollWidth equals clientWidth (897 px), at 390 px the latest day is visible with scrollLeft 0 and the page is 390 px wide.
<!-- SECTION:FINAL_SUMMARY:END -->
