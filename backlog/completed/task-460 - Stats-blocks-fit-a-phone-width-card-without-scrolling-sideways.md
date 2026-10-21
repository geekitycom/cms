---
id: TASK-460
title: Stats blocks fit a phone-width card without scrolling sideways
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 22:52'
updated_date: '2026-10-20 22:58'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 397800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-444 found that a stats block with two stats and their change lines scrolls sideways inside its card at 390px; "down from 45" was cut off. DaisyUI stats lay out horizontally by default. Stats blocks drawn by packages/cms/admin/components/blocks.njk must wrap or stack on narrow cards, on the dashboard and on plugin screens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At 390px wide, a stats block with up to four stats and change lines shows every value and change line with no scroll inside the card or the page
- [x] #2 On a wide full-width card the stats still sit side by side
- [x] #3 A half-width dashboard card on a desktop width also fits its stats without scrolling
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce in headless Chromium: a scratch server with full and half widgets holding 2 and 4 stats with change lines; measure scrollWidth vs clientWidth on each stats block and the page at 390px and 1280px.
2. Failing markup test in blocks.test.ts: a stats block lays its stats out in a wrapping row whose stats grow to fill it.
3. In components/blocks.njk draw the stats block as a wrapping flex row (stats flex flex-wrap, 1px gap on a faint background as the divider) with each stat flex-auto w-auto, so stats sit side by side when they fit and wrap or stack when they do not; let title and change line wrap so a lone wide stat cannot overflow.
4. Rebuild admin.css, rerun the browser measurement at 390 and 1280 (full and half cards) and screenshot.
5. Full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced first in headless Chromium (scratch server with full and half widgets holding 2 and 4 stats with change lines): at 390px every stats block scrolled (scrollWidth 353/754 vs clientWidth 310); at 1280px the half card with four stats scrolled (754 vs 420).

Fix in packages/cms/admin/components/blocks.njk: the stats block is now its own wrapping flex row (stats flex flex-wrap gap-px bg-base-content/10 shadow) and each stat is w-auto flex-auto border-0 bg-base-100. A stat takes its natural width and grows to fill its row, so stats sit side by side when they fit and wrap or stack when they do not. The 1px gap on a faint background is the divider line in both directions, in place of DaisyUI's dashed inline-end border, which looked wrong once a row wraps. The block no longer uses the stats() macro from stat.njk; the At a glance tiles are unchanged.

After (admin.css rebuilt): 390px, every block scrollWidth = clientWidth = 310, page 390/390, nothing clipped, 2 stats on 2 rows and 4 on 4. 1280px: full cards hold 2 and 4 stats in one row (912/912); half card with 2 stats is one row (420/420), with 4 stats two rows of two (420/420); page 1280/1280.

Regression test: blocks.test.ts checks that a stats block is a flex-wrap row whose stats are flex-auto w-auto. The repo has no browser test runner, so the layout itself was proved with the scratch Playwright script, not in CI.

Checks: pnpm build, test, test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Stats blocks drawn by components/blocks.njk now wrap: a flex-wrap row in which each stat grows to fill its line, with a 1px gap as the divider. They stay side by side on wide cards and stack on a phone. Headless Chromium at 390px and 1280px, with full and half cards holding 2 and 4 stats with change lines, showed scrollWidth equal to clientWidth on every block and on the page, and no clipped text. Before the change, the same script measured overflow at 390px and in a half card at 1280px. blocks.test.ts holds a markup regression test, and all repo checks pass.
<!-- SECTION:FINAL_SUMMARY:END -->
