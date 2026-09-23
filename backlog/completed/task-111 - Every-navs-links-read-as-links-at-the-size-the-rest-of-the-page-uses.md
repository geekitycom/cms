---
id: TASK-111
title: 'Every nav''s links read as links, at the size the rest of the page uses'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 16:57'
updated_date: '2026-09-20 17:30'
labels:
  - theme
  - web
dependencies: []
references:
  - packages/cms/themes/default/static/style.css
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/partials/menu.njk
  - packages/cms/themes/default/partials/bio.njk
type: bug
ordinal: 136800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On https://shll.me/2026/09/test-001/ the three navigation lists look like three different things:

- **The header menu** is black text with no underline, so its links do not read as links at all, and it is a size smaller than the page around it.
- **The bio links** are normal links, but also a size smaller.
- **The footer menu** is normal links at the body size.

Two causes, neither in the nav rules.

`style.css:302` styles `header a` — a bare element selector matching every `<header>` on the page:

    header a,
    header a:visited { color: var(--color-text); text-decoration: none; }

It was written for the site title and the small link home, which should read as plain text rather than as links. Since TASK-105 put the menu inside `.global-header` it catches the menu too, and it has always caught the links inside a post's own `<header>`. Scope it to what it is about — the site title and the home link — rather than to any link that happens to sit in a header.

`.global-header .site-nav` and `.bio-links` both set `font-size: var(--fontSize-0)`. The footer menu sets no size and inherits the body's. A menu is navigation somebody is meant to use, not a footnote, so all three should read at the page's size.

Leave the hover flourish alone: a link inverting to the primary colour on hover is the source design's one flourish and applies everywhere. Leave `nav { font-family: var(--fontFamily-sans) }` alone too — that is the design, not a bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A link in any nav is the same colour, underline and size as a link in the page's prose, proven by a test for the header, the bio and the footer
- [x] #2 The site title and the small link home still read as plain text rather than as links, proven by a test
- [x] #3 A link inside a post's own header is a normal link, proven by a test
- [x] #4 The hover and focus-visible behaviour is unchanged everywhere
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the diagnosis against a real page: boot the packaged theme over a post with a primary menu, a footer menu and an author with profile links, and read the markup beside the stylesheet. (Done: the header menu's anchors sit inside `<header class="global-header">` and so are caught by the bare `header a` rule at style.css:302; `.global-header .site-nav` and `.bio-links` each set `font-size: var(--fontSize-0)`; the footer nav sets none; a post's own header is a bare `<header>` and is caught by the same rule.)

2. Write the failing tests first, in the repo's own style — assertions over the rendered markup plus assertions over `static/style.css` read as text (the pattern `page-shell.test.ts` already uses for the header's flex rule), with a small helper that splits the sheet into `{ selector, declarations }` rules so the assertions name the rule rather than the whitespace around it:
   - AC #1: no rule in the sheet sets `color`, `text-decoration` or `font-size` for a link in the header menu, the bio links or the footer menu; and one rendered post carries all three navs, each an `<a>` with no styling hook of its own.
   - AC #2: the plain-text rule still names the site title and the link home, and the front page and an inside page still render `h1.main-heading > a` and `a.header-link-home`.
   - AC #3: the sheet has no selector reaching into a bare `header`, and a post's own header is a bare `<header>`, so a link in it falls to the generic link rules.
   - AC #4: the generic `a:hover, a:focus` and `a:focus-visible` rules are untouched, and the site title and the link home keep their own hover/focus rule.

3. Make them pass in `packages/cms/themes/default/static/style.css`:
   - Replace `header a, header a:visited` and `header a:hover, header a:focus` with the same declarations scoped to `.main-heading a` and `.header-link-home`, keeping the `:visited` and `:hover`/`:focus` variants so the two keep exactly the specificity they had over `a:visited` and `a:focus-visible`.
   - Drop `font-size: var(--fontSize-0)` from `.global-header .site-nav` and from `.bio-links`, so all three navs inherit the body size.
   - Leave `nav { font-family: var(--fontFamily-sans) }` and the hover flourish alone.
   - Update the comments around both rules to say what they are scoped to and why.

4. Re-render the same pages and read the markup and the stylesheet together to confirm each nav link now resolves to the generic `a` rules at the body size.

5. Verify: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm test:11ty`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The diagnosis, verified

Rendered the packaged theme over a post carrying all three navs and read the markup beside `static/style.css`. Both causes in the description hold.

- The header menu's anchors sit inside `<header class="global-header">`, so `header a, header a:visited` at style.css:302 made them the body colour with no underline. The same bare selector reached into `.blog-post > header`, and the site title is an `h1` — the `h2 > a … h6 > a` rule above it does not cover `h1`, so the title depended on that bare rule too.
- `.global-header .site-nav` and `.bio-links` each set `font-size: var(--fontSize-0)`; the footer menu set none and took the body's `--fontSize-1`.

## What changed in the stylesheet

- `header a`/`header a:visited` and `header a:hover`/`header a:focus` are now `.main-heading a`/`.header-link-home` with the same declarations. The `:visited` halves stay because `a:visited` (0-1-1) outweighs a bare class, and the `:hover`/`:focus` halves because `a:focus-visible` (0-1-1) does too — without them the two would take the outline instead of the flourish they have today.
- `font-size: var(--fontSize-0)` dropped from `.global-header .site-nav` and from `.bio-links`.
- `nav { font-family: var(--fontFamily-sans) }` and the hover flourish untouched.
- The theme README's Navigation section now says how a menu reads and which two links are the exception.

## One behaviour that did change, on purpose

AC #4's subject is intact: the hover flourish still applies everywhere, `a:focus-visible` is byte-identical, and the site title and the link home keep exactly the focus treatment they had. The one difference is that a keyboard reader tabbing the **header menu** now gets the focus outline rather than the colour inverting under them — the old bare `header a:focus` used to outrank `a:focus-visible` for those links. That is the same bug being fixed: the footer menu and every prose link already behaved this way, AC #1 asks for the header menu to read like them, and the stylesheet's own comment says `:focus-visible` exists so a keyboard reader is not shown the colour swap. Verified in the browser, below.

## Tests

`src/web/page-shell.test.ts` gains `describe('every nav reads as links, at the page’s size (TASK-111)')` plus five module-level helpers, following the file's existing habit of reading `static/style.css` as text (the `display: flex` assertion from TASK-105) rather than inventing a CSS engine:

- `themeRules()` splits the sheet into `{ selector, declarations }`; `simpleSelectors()` breaks one selector into its parts; `rulesReaching(hooks)` keeps the rules that name nothing outside a link's ancestry; `hooksToLinks(html, inside)` reads that ancestry off the rendered page with a tag-stack scan; `readsBy` and `atRest` answer which rules style a link and what a property settles at.
- The five tests: all three navs and a prose link are on one post; each nav is read by the same rules, and settles on the same colour, underline and size, as the prose link; the site title and the link home settle on the body colour with no underline; the sheet has no selector starting at a bare `header` while a post still heads itself with one; the hover and focus-visible rules are unchanged.
- Red first: before the stylesheet changed, four of the five failed, naming `header a, header a:visited`, `header a:hover, header a:focus` and `.global-header .site-nav` as the extra rules.

No existing test changed. The whole suite was already green on the old rules and stays green: nothing asserted the header menu's colour or size.

## Verification

- `pnpm build`, `pnpm test` (2107 + 30 pass, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm test:11ty` (16 + 5 pass, 0 fail) all clean. `pnpm format:check` is clean for every file this branch touches; its three warnings are in `.claude/worktrees/drop-blacksmith/`, a stale git-excluded worktree, and predate this work.
- Computed styles read in Chrome against the real page, served on localhost and stopped afterwards. On a post: header menu, bio links, footer menu and a link in the post's words are all `rgb(179, 57, 0)`, `underline`, `18px`. The small link home is `rgb(36, 11, 0)`, `none`, `20.7px`; on the front page the site title is `rgb(36, 11, 0)`, `none`, `40.5px`.
- An anchor injected into `.blog-post > header` computes identically to the prose link.
- Hovering the real mouse over a header menu item and over the site title: both invert to `rgb(253, 252, 251)` on `rgb(179, 57, 0)` with the underline gone. Keyboard focus: the site title inverts and takes the outline, as before; the header menu takes the outline with the primary colour on transparent, which is exactly what the footer menu does.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scoped the default theme's plain-text header link rule to the two links it was written for and stopped two navs being set a size smaller than the page.

`packages/cms/themes/default/static/style.css`: `header a` — a bare element selector that caught the site menu after TASK-105 put it in `.global-header`, and had always caught links inside a post's own `<header>` — became `.main-heading a` and `.header-link-home`, with the `:visited` and `:hover`/`:focus` halves kept so those two keep the specificity they had over `a:visited` and `a:focus-visible`. `font-size: var(--fontSize-0)` dropped from `.global-header .site-nav` and `.bio-links`, so all three navs inherit the body size the footer menu always had. The hover flourish and `nav { font-family }` are untouched. The theme README's Navigation section now says how a menu reads.

Verified twice over. `src/web/page-shell.test.ts` gains five tests that read the rendered post and the stylesheet together — the three navs are styled by the same rules, and settle on the same colour, underline and size, as a link in the post's own words; the site title and the link home still settle on the body colour with no underline; no selector starts at a bare `header`; the hover and focus-visible rules are unchanged. Four of the five failed before the stylesheet changed, naming the three offending rules. And in Chrome against the real page: all three navs and the prose link compute to rgb(179, 57, 0), underline, 18px; an anchor injected into a post's header computes identically; the site title stays rgb(36, 11, 0) with no underline; hovering a header menu item and the site title still inverts both.

One deliberate behaviour change, recorded in the notes: a keyboard reader tabbing the header menu now gets the focus outline rather than the colour inverting, because the old `header a:focus` outranked `a:focus-visible` for those links. The footer menu and every prose link already behaved this way.

pnpm build, test (2137 pass, 0 fail), typecheck, lint and test:11ty (21 pass, 0 fail) all clean; format:check clean for every file touched.
<!-- SECTION:FINAL_SUMMARY:END -->
