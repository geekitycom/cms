---
id: TASK-111
title: 'Every nav''s links read as links, at the size the rest of the page uses'
status: To Do
assignee: []
created_date: '2026-09-20 16:57'
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
- [ ] #1 A link in any nav is the same colour, underline and size as a link in the page's prose, proven by a test for the header, the bio and the footer
- [ ] #2 The site title and the small link home still read as plain text rather than as links, proven by a test
- [ ] #3 A link inside a post's own header is a normal link, proven by a test
- [ ] #4 The hover and focus-visible behaviour is unchanged everywhere
<!-- AC:END -->
