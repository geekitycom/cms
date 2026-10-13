---
id: TASK-276
title: 'List screens easier to read: tables on a card, row actions under the title'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-05 09:48'
updated_date: '2026-10-05 10:04'
labels:
  - admin
  - daisyui
dependencies: []
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 235800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After M30 the list screens (Posts, Pages and the other tables) draw their rows straight on the shell's base-200 page background, and Posts and Pages put Edit, Move to trash (or Restore) and View in an Actions column at the far right of a wide table. The owner finds that hard to read and to navigate: the eye has no surface to rest on, and the action for a row is a long way from its title. Draw every table on a base-100 card surface through the table macro, so the change lands once for every list screen, and on Posts and Pages drop the Actions column in favour of WordPress-style row actions under the title, shown when the row is hovered or holds keyboard focus and always shown where there is no hover (a touch or narrow viewport), so a keyboard or phone user loses nothing. The actions stay real links and forms with the same names and values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every table drawn through the table macro sits on a base-100 surface with padding and a shadow or border, not on the page's base-200 background; a table already inside a card (the dashboard's Recent posts) is not double-wrapped
- [x] #2 On Posts and Pages the Actions column is gone; Edit, Move to trash or Restore, and View are drawn under the title in the first cell, revealed on the row's hover and on focus within the row, and always visible on a viewport without hover; posts.test.ts and pages.test.ts pass with the same action names and values
- [x] #3 Keyboard: Tab reaches each row's actions in order after its title, the reveal happens on focus, and keyboard.test.ts passes; the table keeps its caption
- [x] #4 Checked in headless Chrome at 390 and 1280 wide in a light and a dark theme: the card reads against the page, the actions appear on hover at 1280 and are always visible at 390, no horizontal overflow, and the screenshots are linked from the task
- [x] #5 doc-5 says how a list screen is drawn: the card surface and the row actions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape. table(caption, size, zebra, pinRows, pinCols, inCard=false): by default the scrolling wrapper is also the surface (rounded-box bg-base-100 p-2 shadow-sm, the card's own tokens); inCard=true emits the plain wrapper for a table already inside a card's body (dashboard Recent posts, Archive redirects, What the index holds, WordPress paths, Followers of an actor). An argument rather than a CSS in-[.card] override, because the server cannot see the ancestor and three overriding utilities on every table hide the decision from the macro's reader; a template-reading test holds that a table call inside a card call says inCard=true and one outside does not.
2. Posts and Pages rows: <tr class="group *:align-top">; the first cell is the title link (and the page role), then one line of the same ghost xs actions (Edit, the trash or restore form, View). The Actions column and its header go.
3. Prototype the reveal in the real list.njk in headless Chrome (1280 hover and Tab, 390 mouse, 390 and 1280 touch-emulated): A opacity-0 with group-hover/group-focus-within and max-lg/hover:none exceptions; B visible by default, lg:[@media(hover:hover)]:opacity-0 with group-hover/group-focus-within undoing it; C the same gate with invisible/visible. Keep the one that behaves.
4. Tests first: components.test (macro output both ways), list-screens.test (every table on the list screens is on a surface or in a card body), a template-reading nesting test, posts/pages tests for the row actions in the first cell and no Actions column, dashboard test for no double wrap; loosen pages.test's bare <tr> split.
5. Rebuild the sheet; run pnpm build, test, typecheck, lint, format:check.
6. CDP shots of Posts, Pages, Users, Media (plus Dashboard, Tags, Federation) in light and dark at 390 and 1280, hover and focus on Posts and Pages, saved to scratchpad/task-276.
7. doc-5: the table row and the list-screen bullet say how a list screen is drawn.
8. deslop and no-comments passes; notes and final summary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape. table() gains inCard=false. Without it the scrolling wrapper is also the table's surface: rounded-box bg-base-100 p-2 shadow-sm, the card macro's own tokens, so a table and a card are one surface across the admin. With inCard=true it emits the plain wrapper. Five tables sit in a card's body and pass it: dashboard Recent posts, Archive redirects (settings/permalinks), What the index holds (tools/content-index), WordPress paths (federation/settings), Followers of an actor (federation/followers). I chose an argument over a CSS in-[.card-body]: override because the server cannot see the ancestor, and three overriding utilities on every table would hide the decision from whoever reads the macro. A test in list-screens.test.ts reads every template, tracks call/endcall nesting, and holds that a table call inside a card call passes inCard=true and one outside does not.

Row shape on Posts and Pages: <tr class="group *:align-top">, first cell = title link (and a page's role), then one line (whitespace-nowrap) of the same ghost xs Edit link, trash/restore form (same csrf_token, return, name=action value=trash|restore) and View link. The Actions column and header are gone. *:align-top puts author, date and status on the title's line; DaisyUI's .table cells are vertical-align: middle.

Prototype, in the real list.njk, headless Chrome, Posts light: A = opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100 [@media(hover:none)]:opacity-100 (hidden by default, two exceptions). B = lg:[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 (visible by default, hidden in one condition). C = B's gate with invisible / visible. Measured: A and B are identical in Chrome. At 1280 with a mouse, every row's actions are at opacity 0 and the hovered row goes to 1. A Tab walk goes title, Edit, Move to trash, next title, with opacity 1 throughout. At 390 they show with a mouse (hover:hover) and with touch emulation (hover:none, pointer:coarse). At 1280 with touch emulation they show. C matched on screen but at rest exposed 0 Move to trash nodes in Chrome's accessibility tree, against 75 for B, so a screen reader browsing the table would hear no actions. Kept B. It hides in exactly one condition, and the compiled sheet shows that condition is the same @media (hover: hover) that gates Tailwind's group-hover:, so wherever the actions are hidden a hover can show them. It also fails visible. A needs two exceptions to stay correct. Prototype shots and reports: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-276/proto/.

Verification. Chrome pass (script kept at /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-276/t276-shots.mts, run from packages/cms/src/admin/__testing__ and removed after) over Posts, Pages, Users, Media, Tags, Federation and the Dashboard, light and dark (prefers-color-scheme), 390 and 1280. Every table outside a card computes a base-100 background, 8px padding and a box-shadow on the base-200 page: light oklch(1 0 0) on oklch(0.98 0 0), dark oklch(0.2533 …) on oklch(0.2326 …). The Dashboard and Followers card tables compute a transparent background, no shadow and 0 padding, so nothing is double-wrapped. documentElement.scrollWidth equals the viewport on every screen at both widths. Wide tables scroll inside their surface at 390. Hover, focus and Tab walk as in the prototype on Posts and Pages in both themes. Screenshots: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/task-276/ named <screen>-<theme>-<width>[-hover|-focus].png. Gate from the repo root: pnpm build, pnpm test (4616 + 30 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all exit 0. Red first: the nesting test failed on exactly the five card tables, the dashboard and followers surface tests failed on the double wrap, and the posts/pages row tests failed against HEAD's list.njk on both the Actions header and the order check (with the header removed alone). deslop: nothing to remove. no-comments: trimmed the macro header's rationale sentence and three test-helper docblocks, and renamed says to passesInCard.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every table the table macro draws now sits on a base-100 surface (rounded-box bg-base-100 p-2 shadow-sm, the card's tokens), and the five tables already in a card pass inCard=true so they are not wrapped twice. A template-reading test holds that rule for any future table. Posts and Pages lose the Actions column. Edit, Move to trash or Restore, and View sit on one line under the title. Where the screen is lg or wider and the device hovers, they are transparent until the row is hovered or holds focus. Everywhere else they always show. They stay real links and forms with the same names and values, in the Tab order and the accessibility tree. The reveal was picked from three prototypes measured in headless Chrome. Verified by the full gate (build, test, typecheck, lint and format all pass) and a CDP pass over Posts, Pages, Users, Media, Tags, Federation and the Dashboard in light and dark at 390 and 1280. doc-5 says how a list screen is drawn.
<!-- SECTION:FINAL_SUMMARY:END -->
