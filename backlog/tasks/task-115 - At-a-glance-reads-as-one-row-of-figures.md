---
id: TASK-115
title: At a glance reads as one row of figures
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 18:29'
updated_date: '2026-09-20 19:01'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/static/admin.css
  - packages/cms/admin/pages/dashboard/home.njk
type: bug
ordinal: 139800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dashboard's At a glance panel puts its six counts at six different heights, with some labels broken across two lines, so it reads as a scatter rather than as a row.

Two causes, both in `.admin-counts` (admin.css:250):

    .admin-counts { display: flex; gap: 1.5rem; }
    .admin-counts div { display: flex; flex-direction: column-reverse; }

The container leaves `align-items` at `stretch`, so every cell is as tall as the tallest, and `column-reverse` packs a cell's content from the bottom. A cell whose label fits on one line therefore sits low, and one whose label wraps sits high: 'Published posts' wraps and its 2 is at the top of the row, while 'Drafts' does not and its 0 is halfway down.

The labels wrap because a cell is sized by its content with nothing to stop 'Published posts' or 'Comments waiting' breaking. The panel has room for them.

The numbers should sit on one line, with their labels under them, and the row should still behave on a narrow screen — the admin has no breakpoint for this panel today, so whatever is used should wrap as a row of cells rather than overflow.

`column-reverse` is there because a definition list is `dt` then `dd` and the number is the `dd`: the markup has to stay in that order and the number has to be drawn above the label. Keep that constraint; a grid with two rows would also satisfy it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every count's number sits on the same line as the others, whatever its label's length, proven by a test
- [x] #2 A label is not broken across lines where the panel has room for it
- [x] #3 The row wraps rather than overflowing when the panel is narrow
- [x] #4 The markup stays a dl of dt then dd, with the number drawn above its label
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the diagnosis in `packages/cms/admin/static/admin.css` (`.admin-counts` at line 250) and in `packages/cms/admin/pages/dashboard/home.njk`: the flex container leaves `align-items` at `stretch` and the cell packs its content from the bottom with `column-reverse`, so a cell whose label wraps draws its number higher than one whose label does not.
2. Red first, in `packages/cms/src/admin/styles.test.ts` (the admin's equivalent of the theme's stylesheet test): add a rule reader over `admin.css` — selector and declarations, the way `themeRules` reads the theme's sheet — and assert that a number's height is fixed by the cell rather than by its label (the cell is a two-row grid, the `dd` in the first row and the `dt` in the second, nothing left depending on content order), that the row wraps rather than overflows, and that `home.njk` is still a `dl` of `div`s each holding a `dt` then a `dd`.
3. Green: in `admin.css` replace `column-reverse` with an explicit two-row grid — `.admin-counts div { display: grid }`, `.admin-counts dd { grid-row: 1 }`, `.admin-counts dt { grid-row: 2 }` — and give the container `flex-wrap: wrap` and `align-items: start`, so a cell is as tall as its own content, cells that do not fit on one line move to the next rather than being squeezed until their labels break, and every number sits at the top of its cell.
4. Verify: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`, prettier over the two files changed, and the real dashboard in a browser at a wide and a narrow width.
5. Notes, final summary, check the criteria the evidence proves, Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Diagnosis, confirmed

The task's reading of `admin.css:250` is right. `.admin-counts` is a flex row that never set `align-items`, so every cell was stretched to the tallest; `.admin-counts div` was `column-reverse`, which packs a cell's content against its bottom edge. A cell's number was therefore drawn at (cell bottom − its own content height), so a label that wrapped lifted its number. Measured on the real dashboard before the change, the six numbers were at three different heights — 184, 206 and 184 px — with `Published posts`, `Comments waiting` and `Messages unread` each broken over two lines.

## The change

`packages/cms/admin/static/admin.css`, `.admin-counts` only:

- The cell is a two-row grid instead of a reversed flex column: `display: grid` with `dd { grid-row: 1 }` and `dt { grid-row: 2 }`. The markup stays `dt` then `dd`, the number is still drawn above its label, and a number now sits at a fixed offset from the top of its cell rather than at one measured up from the bottom.
- The container gets `align-items: start`, so a cell is as tall as its own content and the tallest cannot stretch the rest.
- The container gets `flex-wrap: wrap`. A flex line that wraps moves a cell that does not fit onto the next line instead of shrinking it, which is what was breaking the two long labels in a panel with room for them, and it is also what keeps the row from overflowing a narrow panel. No breakpoint was added; none is needed.

A wrapping grid (`repeat(auto-fit, minmax(7.5rem, 1fr))`) was tried in the browser as the alternative. It splits the six counts into even columns — 3 and 3 at the panel's usual width — which reads as a block of figures rather than as the row the task asks for, so `flex-wrap` was kept.

## Test

`packages/cms/src/admin/styles.test.ts` is the admin's equivalent of the theme's stylesheet test, so the new cases went there rather than into a new file. It gained two module-level helpers in the shape of `page-shell.test.ts`'s `themeRules`: `adminRules()`, which reads the sheet's `selector { declarations }` pairs, and `declaration(selector, property)`, which answers what one rule settles a property at. Three cases follow: the number's height is fixed by the cell rather than by the label, the row wraps, and `home.njk` is still a `dl` whose every cell is a `dt` then its `dd`. The first two were written red and went green on the CSS change; the third is a guard on the constraint the task names, and it was checked against a reversed cell by hand before being kept.

## Verification

The real dashboard, rendered through the admin's own harness and measured in Chrome against the live stylesheet.

- Wide (1400 px viewport, 535 px panel): five numbers on the first line at `top: 184`, `Messages unread` wrapped to a second line at 264. Every label on one line. No horizontal overflow on the panel or the page.
- Narrow (500 px viewport, 416 px panel): four then two, both lines' numbers level. Every label on one line, nothing overflowing.
- Label length no longer moves a number: forcing `Published posts` onto two lines left its number at `top: 184`, level with the other three on its line, where before the change the same cell sat 22 px above them.
- Panel narrowed by hand to 300, 240, 180 and 140 px: the row went to three, four, five and six lines with no overflow at any of them. A label only breaks at a 103 px panel — far below the panel's own 18rem minimum — and even there the numbers on a line stay level.

`pnpm build && pnpm test && pnpm typecheck && pnpm lint` all pass: 2121 tests in `@geekity/cms` and 30 in the demo, none failing. `prettier --write` over the two changed files reports both unchanged.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`.admin-counts` in `packages/cms/admin/static/admin.css` now draws a cell as a two-row grid — the `dd` in the first row, the `dt` in the second — instead of a flex column packed from its bottom edge, and the row itself is `flex-wrap: wrap` with `align-items: start`. A number is therefore at a fixed offset from the top of its cell rather than measured up from a stretched bottom, and a cell that does not fit moves to the next line rather than being squeezed until its label breaks. The markup is untouched: still a `dl` of `dt` then `dd`, with the number drawn above its label.

Verified in Chrome against the real dashboard rendered through the admin's harness: at a 535 px panel five numbers sit level on one line and the sixth wraps, at a 416 px panel four then two, every label on one line and nothing overflowing at either width or at panels narrowed to 300, 240, 180 and 140 px; and a label forced onto two lines no longer moves its number, which before the change sat 22 px high. Three new cases in `packages/cms/src/admin/styles.test.ts` read the rules out of the sheet as text and hold the fix; `pnpm build && pnpm test && pnpm typecheck && pnpm lint` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
