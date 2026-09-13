---
id: TASK-80
title: >-
  Page shell: base layout, header, footer and stylesheet in the andrewshell.org
  design
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:36'
updated_date: '2026-09-13 16:59'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-79
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/static/style.css
  - /Users/andrewshell/code/wordpress/asdo-theme/header.php
  - /Users/andrewshell/code/wordpress/asdo-theme/footer.php
  - /Users/andrewshell/code/wordpress/asdo-theme/style.css
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 105800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite the shell of the default theme to the source design (decision-16) while keeping every block a site overrides. layouts/base.njk keeps the blocks title, head, alternates, header, content, footer and scripts, wraps the page in a global-wrapper that carries data-is-root-path on the front page, and keeps the skip link. The header shows an h1 main-heading site title and the tagline on the front page and a small header-link-home link everywhere else; there is no navigation in the header, the site menu moves to the bio (TASK-82). The footer prints the copyright with the year and the site author, Published with Geekity, an RSS link to /feed/, and the siteAuthor links as rel="me" in an hlist; webrings and other site-specific links are left to a site footer override, and the README says so. static/style.css is rewritten from the source stylesheet: its custom properties (spacing, type scale, fonts, colours), serif body and sans headings at an 18px root, the 42rem wrapper, the primary-colour rule, links that invert on hover with a focus-visible outline, the screen-reader-text class, prose, lists, blockquote, tables, the hlist, small, and the 42rem media query; no normalize file, the reset the source relies on is folded in. The source is light only; add a dark scheme under prefers-color-scheme: dark that keeps the design on dark paper, with color-scheme: light dark so form controls follow. Every text and background pair in both schemes meets WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text, focus outlines and rules, including links on paper, inverted links on the primary colour, blockquote text, footer text and .small text; a test reads the custom properties out of the stylesheet and computes the ratios so a later colour change cannot quietly break one. Class names follow the source theme. The three feed alternates, the comments feed, the ActivityStreams alternate and the webmention link stay in the head as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 layouts/base.njk keeps the seven blocks and the skip link, wraps the page in .global-wrapper with data-is-root-path="true" only at /, and prints the h1 site title and tagline on the front page and .header-link-home elsewhere, with no header navigation
- [x] #2 The footer prints the copyright with the current year and site author, Published with Geekity, an RSS link and one rel="me" link per siteAuthor link in an .hlist; a site with no siteAuthor gets the footer without the links
- [x] #3 static/style.css carries the source design tokens, type, colours, wrapper, links, rule, prose, lists, blockquote, table, hlist and media query, and passes prettier; the old system font stack is gone
- [x] #4 A dark scheme under prefers-color-scheme: dark keeps the design on dark paper with color-scheme: light dark, and a test reads the light and dark custom properties from the stylesheet and proves every text and background pair listed in the description meets WCAG 2.2 AA, 4.5:1 for body text and 3:1 for large text, focus outlines and rules
- [x] #5 Every existing head link (three feeds, comments feed, ActivityStreams alternate, webmention, canonical) is still emitted, and the demo theme override of layouts/post.njk still renders through the new base
- [x] #6 packages/cms/src/web/site.test.ts and apps/demo/test/site.test.ts are updated for the new markers and pass; themes/default/README.md describes the header rule, the footer, both colour schemes and where webrings go
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Red: a new node:test file, packages/cms/src/web/theme-colors.test.ts, parses the custom properties out of themes/default/static/style.css for :root and the prefers-color-scheme: dark block and computes WCAG 2.2 relative-luminance ratios for a table of pairs (text/body, link/paper, inverted link on primary, secondary blockquote text, small and footer text, text on base, base-2, base-3 and the code block background, the primary rule and focus outline at 3:1). The table is a const so TASK-86 can extend it.
2. Red: shell tests in packages/cms/src/web/site.test.ts — .global-wrapper with data-is-root-path="true" only at /, h1.main-heading plus the tagline on the front page, .header-link-home elsewhere, no nav in <header>, and the footer's copyright year, site author, Published with Geekity, RSS link and one rel="me" link per siteAuthor link in a .hlist, with a site whose author matches nobody getting the footer without the links.
3. Green: rewrite layouts/base.njk to the source shell — the screen-reader-text skip link, .global-wrapper, .global-header, <main id="main">, the new footer — keeping the seven blocks and every head link. The site menu leaves the header and is rendered in the footer block for now (TASK-83 moves it into the bio), as nav.site-nav so the menu tests keep passing.
4. Green: the current year. toDate in web/templates.ts learns the string "now", so the theme writes {{ "now" | date("year") }}; docs/eleventy.config.example.js gets the same so an Eleventy build of the same content renders the same footer. Unit test in templates.test.ts.
5. Green: rewrite static/style.css from the source stylesheet — its custom property block (maxWidth, spacing, font families, weights, the 1.2 minor third scale, colours) plus code-block tokens for TASK-86, the folded-in reset, html/body at an 18px serif root, sans headings, .global-wrapper at 42rem, the primary rule, links inverting on hover with a focus-visible outline, .screen-reader-text, prose, lists, .hlist, blockquote, tables, small, the 42rem media query, and a prefers-color-scheme: dark block with color-scheme: light dark. The component rules the current markup still uses (listings, tags, pagination, conversation, comment and contact forms) are carried onto the new tokens rather than dropped, so nothing goes unstyled before TASK-82-84.
6. Update the markers in packages/cms/src/web/site.test.ts, front-page.test.ts, author-archive.test.ts and apps/demo/test/site.test.ts; the demo's own stylesheet keeps its marker.
7. Docs: themes/default/README.md gains a Page shell section (the header rule, the footer, the two colour schemes and where webrings go) and the Navigation section says the menu is in the footer block for now; root README.md and packages/cms/README.md say the theme follows the andrewshell.org design and has a dark scheme.
8. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, and curl a running demo for the front page, a post and the 404.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**What was built.**

`layouts/base.njk` is now the source design's shell: the `.screen-reader-text` skip link, one `.global-wrapper` carrying `data-is-root-path="true"` only when `page.url` is `/` (so a static homepage under the Reading settings counts, and the 404 does not), `.global-header`, `<main id="main">` and the footer. The header is `h1.main-heading` plus the tagline at the root and `a.header-link-home" elsewhere. All seven blocks and every head link are unchanged.

**The menu.** The design has no header navigation and the bio it belongs in does not exist until TASK-83, so the menu is rendered in the `footer` block for now, as `nav.site-nav > ul.hlist` with `class="is-current" aria-current="page"` on the current item. That keeps site.test.ts, front-page.test.ts, admin/pages.test.ts and the demo's contact test passing unchanged. **TASK-83 moves it into the bio and takes it out of the footer.**

**The current year.** The footer needs a date no file carries, so `toDate` in `web/templates.ts` learned the one word `'now'`: `{{ "now" | date("year") }}` is the year at render time, through the site's timezone like every other date. `docs/eleventy.config.example.js` learned the same word so an Eleventy build of the same content renders the same footer. It reads the wall clock rather than the CMS's injected `now`, which is why the tests compute the expected year rather than hardcoding it.

**The stylesheet** is rewritten from the source: its custom properties (maxWidth, spacing, font families and weights, line heights, the 1.2 minor-third scale, colours), the reset folded in, an 18px serif root with sans headings, the 42rem wrapper, the primary-colour `hr` and table header rule, links that invert on hover with a `:focus-visible` outline, `.screen-reader-text`, prose, lists, `.hlist`, blockquote, tables, `small`/`.small`, and the 42rem media query. The old system font stack and the `--ink`/`--paper`/`--accent` tokens are gone. Two tokens are new and named for TASK-86: `--color-code-background` and `--color-code-text`. `--color-error` replaces the two hardcoded `#b3261e` values so the dark scheme can lift it.

The component rules the markup still uses today — listings, tags, pagination, the conversation, the comment and contact forms — were carried onto the new tokens rather than deleted, so nothing goes unstyled before TASK-82, TASK-83 and TASK-84 rewrite that markup. A comment in the file says so.

**The dark scheme** redefines the same colour tokens under `prefers-color-scheme: dark`, with `color-scheme: light dark` on `:root`. Ratios against the paper: text 15.94, primary 6.69, secondary 6.40, error 7.76; text on base 14.01, base-2 13.73, base-3 12.99, code background 15.03. The light scheme is the source's, checked rather than assumed: text 18.25, primary 5.85, secondary 4.62, error 6.38.

| Token | Light | Dark |
| --- | --- | --- |
| `--color-body` | `#fdfcfb` | `#191110` |
| `--color-text` | `#240b00` | `#f4ece7` |
| `--color-primary` | `#b33900` | `#ef7a48` |
| `--color-secondary` | `#007ab3` | `#3ea0d8` |
| `--color-base` | `rgb(245 243 243)` | `rgb(38 30 28)` |
| `--color-base-2` | `rgb(247 248 249)` | `rgb(34 33 36)` |
| `--color-base-3` | `rgb(255 255 255)` | `rgb(45 36 33)` |
| `--color-code-background` | `#f6f3f1` | `rgb(30 24 22)` |
| `--color-code-text` | `#240b00` | `#f4ece7` |
| `--color-error` | `#b3261e` | `#ff8093` |

**One change outside the plan.** `code` gained `overflow-wrap: break-word`: a long file path in the demo's prose reached the gutter at phone width in the browser. A block of code still scrolls instead.

**Verification.** `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass (1743 + 21 tests), as does `pnpm test:11ty` (16 + 5). Two new node:test files: `src/web/page-shell.test.ts` (the wrapper, the header rule on four kinds of page and the 404, the footer in all three states, and every head link) and `src/web/theme-colors.test.ts` (the palette, 32 assertions). Both were written red first.

The demo was booted twice over HTTP and curled: the front page (`data-is-root-path="true"`, `h1.main-heading`, the tagline), a post and the 404 (`a.header-link-home`, no root marker), the footer (`&copy; 2026, Joe Blog · Published with Geekity`, the RSS link, no `rel="me"` because no user answers to Joe Blog), and `/theme/style.css` at 200. A second copy of the demo content with the theme unchosen was opened in Chrome to look at the packaged theme itself, light and with the dark tokens injected: the serif body, the sans headings, the rust links and the footer all render, the page does not scroll sideways at 485px, and a fenced block scrolls inside itself. Both servers were stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote the default theme's shell to the andrewshell.org design (decision-16). `layouts/base.njk` keeps its seven blocks and the skip link and now wraps the page in a `.global-wrapper` marked `data-is-root-path="true"` at `/` only, heads the front page with an `h1.main-heading` and the tagline and every other page with a small `.header-link-home`, carries no header navigation, and ends with a footer holding the copyright year, the site author, Published with Geekity, an RSS link and one `rel="me"` link per `siteAuthor` link in an `.hlist`. The menu moved out of the header into the footer block until TASK-83 puts it in the bio. `static/style.css` is rewritten from the source stylesheet — its tokens, the serif body and sans headings at an 18px root, the 42rem wrapper, the primary rule, inverting links with a focus-visible outline, prose, lists, blockquote, tables, the hlist and the 42rem media query — with the reset folded in, the old system font stack gone, and a `prefers-color-scheme: dark` scheme on dark paper under `color-scheme: light dark`. The `date` filter learned `"now"` for the copyright year, in the CMS and in the Eleventy example config. Verified with two new red-first node:test files — `src/web/page-shell.test.ts` over HTTP and `src/web/theme-colors.test.ts`, which reads the custom properties out of the stylesheet and proves every text and background pair in both schemes meets WCAG 2.2 AA — plus `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm test:11ty` all green, and the demo booted and curled (front page, post, 404, footer, stylesheet) and looked at in a browser in both schemes.
<!-- SECTION:FINAL_SUMMARY:END -->
