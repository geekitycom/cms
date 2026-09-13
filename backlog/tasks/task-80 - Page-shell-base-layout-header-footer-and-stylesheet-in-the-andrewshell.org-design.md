---
id: TASK-80
title: >-
  Page shell: base layout, header, footer and stylesheet in the andrewshell.org
  design
status: To Do
assignee: []
created_date: '2026-09-13 13:36'
updated_date: '2026-09-13 14:30'
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
- [ ] #1 layouts/base.njk keeps the seven blocks and the skip link, wraps the page in .global-wrapper with data-is-root-path="true" only at /, and prints the h1 site title and tagline on the front page and .header-link-home elsewhere, with no header navigation
- [ ] #2 The footer prints the copyright with the current year and site author, Published with Geekity, an RSS link and one rel="me" link per siteAuthor link in an .hlist; a site with no siteAuthor gets the footer without the links
- [ ] #3 static/style.css carries the source design tokens, type, colours, wrapper, links, rule, prose, lists, blockquote, table, hlist and media query, and passes prettier; the old system font stack is gone
- [ ] #4 A dark scheme under prefers-color-scheme: dark keeps the design on dark paper with color-scheme: light dark, and a test reads the light and dark custom properties from the stylesheet and proves every text and background pair listed in the description meets WCAG 2.2 AA, 4.5:1 for body text and 3:1 for large text, focus outlines and rules
- [ ] #5 Every existing head link (three feeds, comments feed, ActivityStreams alternate, webmention, canonical) is still emitted, and the demo theme override of layouts/post.njk still renders through the new base
- [ ] #6 packages/cms/src/web/site.test.ts and apps/demo/test/site.test.ts are updated for the new markers and pass; themes/default/README.md describes the header rule, the footer, both colour schemes and where webrings go
<!-- AC:END -->
