---
id: TASK-277
title: >-
  Small screens: list rows show the title with a toggle that opens the other
  columns as a key-value list
status: Done
assignee:
  - '@claude'
created_date: '2026-10-05 10:14'
updated_date: '2026-10-05 10:40'
labels:
  - admin
  - daisyui
dependencies:
  - TASK-276
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 236800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a phone the list screens scroll their table sideways inside its card, so Author, Tags, Categories, Date and Status are off screen and the reader pans to find them. The owner asked for the WordPress-style answer instead: below the breakpoint where the table no longer fits, each row shows only its first column (the title, with the row actions TASK-276 put under it) and a toggle arrow at the right edge; opening the toggle reveals the other columns under the title as a vertical key-value list, the column heading as the key and the cell as the value. At desktop width the table is unchanged. The toggle works with no JavaScript (a checkbox and label or an equivalent the admin already uses), has an accessible name that says which row it opens, and its state is exposed to assistive tech. The mechanism lives in the table macro or a convention its callers follow, so other list screens can adopt it; this task applies it to Posts and Pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On Posts and Pages below the lg breakpoint each row shows the title cell and a toggle at the right edge and no other column; the table does not scroll sideways and the page has no horizontal overflow at 390 wide
- [x] #2 Opening a row's toggle shows every other column of that row under the title as a key-value list whose keys are the column headings and whose values are the cells, including the status badge; closing it hides them again; rows open and close independently
- [x] #3 At 1280 wide the table is drawn exactly as before this task, with every column and no toggle
- [x] #4 The toggle needs no JavaScript, carries an accessible name that names the row, exposes open or closed state, is reachable by Tab in order after the row's actions, and keyboard.test.ts passes
- [x] #5 posts.test.ts, pages.test.ts and list-screens.test.ts pass; the mechanism is documented in doc-5 so another list screen can adopt it
- [x] #6 Checked in headless Chrome at 390 and 1280 in a light and a dark theme, closed and open, with screenshots linked from the task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape. A stacking row is a convention the table macro's file owns, so another list screen adopts it by importing three things: the first cell stays the caller's (title, row actions) and ends with the row's toggle, rowToggle(name), whose accessible name names the row; every other cell is cell(key), the key being the column's heading, emitting <td data-label=key> hidden below lg until the row's toggle is open, then one key-value line (the key drawn from data-label); every heading after the first is heading(label), hidden below lg. At lg and up the toggle is display:none and the cells and headings draw as before.
2. Baseline first: CDP screenshots of Posts and Pages at 1280 and 390, light and dark, before any change, so AC #3 is a byte comparison of the 1280 shots.
3. Prototype in the real list.njk, measured at 390 in headless Chrome: (A) a visually hidden checkbox with a label drawn as the arrow, cells shown by group-has-checked; (B) a details/summary in the first cell, cells shown by group-has-open. Both share the stacking layout. Measure overflow, toggle role/name/state in Accessibility.getFullAXTree, the Tab walk, independent rows, the open row's reading order, and what the AX tree says about the table. Keep one, delete the other.
4. Tests first (red), then code: components.test pins the new macros' markup; posts/pages tests assert each row's toggle names the row and comes after the actions, and every other cell carries its heading as data-label; list-screens asserts Posts and Pages stack and other screens are untouched; loosen tests that pinned a bare <td> or <th> to the attribute they assert.
5. Rebuild the sheet; pnpm build, test, typecheck, lint, format:check.
6. CDP pass on Posts and Pages, 390 and 1280, light and dark, closed and open; 1280 shots compared with the baseline; screenshots in scratchpad/task-277.
7. doc-5: the table row and the list-screen notes say how a screen adopts stacking rows.
8. deslop and no-comments; notes, final summary.

9. Revision after prototyping: a fourth macro, row(), carries the stacking classes on the <tr> (block below lg, relative for the toggle, the row border moved from DaisyUI's cells to the row), and cell takes nowrap for the columns that had whitespace-nowrap. The 'other screens untouched' test was dropped: the 1280 byte comparison and the scope of the diff cover it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pickup. A previous agent stopped after prototyping. It left B (details/summary) in the tree with tests written; prototype A (visually hidden checkbox and label) was not in the tree. I kept its macros and tests, removed one test-helper docblock, softened one overstated line in table.njk's header, and wrote doc-5.

Data shape. table.njk gains row(), heading(label), cell(label, nowrap) and rowToggle(name). row() is <tr class="group *:align-top …">: below lg it is display:block, relative, padded at the end for the toggle, with the border moved from DaisyUI's cells (.table puts border-bottom on the cells of non-last rows) to the row. heading() is a <th scope=col> hidden below lg. cell() is <td data-label=label>, hidden below lg until the row has an open descendant (group-has-open), then a flex line whose ::before draws content:attr(data-label) as the key. rowToggle() is <details class="absolute end-1 top-1 lg:hidden"><summary class="btn btn-ghost btn-xs btn-square"> holding an sr-only 'Details of <name>' and an aria-hidden chevron that turns on open. Posts and Pages (documents/list.njk) use them; the title heading stays a plain <th>.

Why B over A (prototype logs in /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-277/proto-A.log, proto-A/, proto-B.log, proto-B/). Both stacked without overflow at 390 (documentElement.scrollWidth 390, table wrapper not scrolling). A's toggle surfaced in Chrome's accessibility tree as a checkbox, 'Details of Later, checked=false', so a screen reader hears a form control checked or not rather than a disclosure, and A's Tab walk stopped on a bare input. B's summary is a DisclosureTriangle named 'Details of Later' with expanded=false/true, native Space and Enter, no script. A's script run also crashed partway, so B is the one with the full measurement set. Kept B.

Accessibility tree at 390 (B, Chrome, Accessibility.getFullAXTree). The table keeps role table with rowgroup and row roles (26 rows on Posts); display:block on the <tr> does not demote it to a layout table. The hidden headings and closed rows' cells leave the tree: 1 columnheader (Title) and 25 cells closed, against 6 columnheaders and 150 cells at 1280. Opening a row adds its cells back as role cell, in reading order after the first cell, each name starting with its key from ::before ('Date | 2026-12-01', 'Status | Scheduled'), which stands in for the hidden column header. An empty value (a fixture post with no author) reads as the key alone.

Red first. With HEAD's table.njk and list.njk put back, components.test.ts, list-screens.test.ts, pages.test.ts and posts.test.ts ran 267 pass, 7 fail: the macro markup pin and, on posts, postTrash and pages, the toggle named for its row after the row's actions with nothing focusable after it, and every other cell labelled with its column's heading. pages.test.ts's two bare <th scope="col">X</th> matches were loosened to allow the class.

Verification. CDP script (/private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-277/t277.mts, copied to src/admin/__testing__ to run on ports 3317 and 9333 after lsof showed both free, removed afterwards, profile deleted per run) over Posts and Pages, light and dark (prefers-color-scheme), at 1280 and 390, closed and open. 390: only the first cell shows, the toggle sits at the row's right edge (right 362 in a 390 viewport, 24x24), no page overflow and no table scroll, closed and open. Space on row 0's toggle opens row 0 only; a click on row 3's opens row 3 and leaves row 0 open; Space again closes row 0 and leaves row 3. Tab walk: title, Edit, Move to trash, Details of <title>, next title, with a 2px solid focus outline on each. 1280: every column shows, the toggle is display:none, and all four 1280 shots (posts and pages, light and dark) are byte-identical (cmp) to /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-277/baseline/ taken before any change. Screenshots and report: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-277/final/ named <screen>-<theme>-<width>[-open].png. Gate from the repo root: pnpm build, pnpm test (4624 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. deslop: nothing to remove. no-comments: no deletions; the header line 'so a narrow screen never scrolls the table sideways' became 'instead of scrolling the table sideways'.

Other list screens, not converted (read from their templates, not tried in a browser). Each adopts it the same way: body rows in row(), the first cell ending in rowToggle(name), every other cell as cell(label), every heading after the first as heading(label). Users (Username, Email, Created, Actions): the Actions column should first move under the username as TASK-276 did on Posts, and the Email cell is an inline form that would sit on its key's line. Media (File, Alt text, Uploaded, Size, Link, Used by, Actions): the same Actions move; Link holds a copy field, wide for one line at 390. Tags and Categories (documents/taxonomy.njk: name, Posts, Files, Rename, Actions): Rename is a form; Actions moves under the name. Connected apps (users/apps.njk, two tables, each with Actions): the same move. App activity (users/activity.njk: When, Endpoint, Action, App, User, Result) and Syndication (Name, Id, URL, Status): plain cells, a direct fit. Followers (federation/followers.njk, tables in cards, two with Actions): fits after the Actions move. The row-heading tables (activity entry, What the index holds) and the narrow card tables (dashboard Recent posts, Archive redirects, WordPress paths) need nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Below lg, Posts and Pages now show each row as its title and row actions with an arrow at the right edge; opening the arrow lists the row's other columns under the title, heading as key and cell as value, status badge included. At lg and up the table is drawn as before. The arrow is a <details>/<summary> named 'Details of <title>', so it works without script, is reached by Tab after the row's actions, and is exposed as a disclosure with its expanded state. The mechanism is four macros in table.njk (row, heading, cell, rowToggle) that another list screen can adopt, documented in doc-5. Chosen over a checkbox-and-label prototype because Chrome exposed that as a checked checkbox rather than a disclosure. Verified red-then-green (7 new tests fail on HEAD's templates), by the full gate (build, 4624 + 30 tests, typecheck, lint, format all exit 0), and in headless Chrome on Posts and Pages, light and dark, 390 and 1280, closed and open: no overflow at 390, rows open and close independently, the Tab walk and the accessibility tree as recorded in the notes, and the 1280 shots byte-identical to the pre-change baseline. Screenshots in /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-277/final/.
<!-- SECTION:FINAL_SUMMARY:END -->
