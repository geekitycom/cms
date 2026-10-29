---
id: TASK-527
title: >-
  Per-layout Markdown and Gemini templates, so a theme can keep a layout's
  formats side by side
status: To Do
assignee: []
created_date: '2026-10-29T13:46:00Z'
labels:
  - theme
  - markdown
  - gemini
dependencies: []
priority: medium
type: feature
ordinal: 429800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A theme draws each kind of page with its own HTML layout (layouts/front-page.njk, post.njk, page.njk, home.njk, author.njk, ...), but every page's Markdown is one shared sandwich: partials/markdown-header.md.njk, the page's own words, partials/markdown-footer.md.njk, with per-type differences as {% if %} branches inside those two files. Only the status pages (404, 410, 500, 503) have a .md.njk layout of their own. Gemini mirrors the Markdown slots and converts a .md.njk where no .gmi.njk exists.

So a theme that adds anything to one layout's HTML has nowhere matching to put its Markdown. A site theme whose static front page lists recent posts, shows the author's card or links further sections has to override the whole default markdown-footer.md.njk, wrap its additions in {% if staticFrontPage %}, and re-diff the copied remainder against the package after every upgrade. The HTML and the Markdown of that page live in different files and drift (sections present in the HTML go missing from the .md and the .gmi). The bio is a case in point: the Markdown context carries bio on a solo author homepage, but the default header prints it only when the homepage lists posts, and a theme that wants it on its static front page has to override the header or the footer to get it.

Proposal: an optional layouts/<name>.md.njk for each HTML layout, looked up like the status pages' bodies, that writes what goes around the page's words for that kind of page and may include the shared header and footer or leave them out. Where a theme has none, today's header + words + footer applies, so no existing theme changes output. Gemini follows the existing lookup order for the same slot (theme .gmi.njk, theme .md.njk converted, default .gmi.njk, default .md.njk converted), so a theme writes Gemini templates only where conversion falls short. Not every template needs a twin: most HTML partials (head-end, body-end, jsonld, the form partials) mean nothing in Markdown. Markdown partials for building blocks a layout's formats share, such as bio and a post list, are worth considering so both formats include the same pieces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A theme can add layouts/front-page.md.njk (and the same for post, page, home, author and the other HTML layouts); when it exists, that page's Markdown is built from it
- [ ] #2 A layout Markdown template can include the shared header and footer, or leave either out, and has the page's words available to place
- [ ] #3 With no layout Markdown template, every page's Markdown and gemtext is byte-identical to today's
- [ ] #4 The .gmi page resolves the same slot with the existing four-step lookup, so a theme's layout .md.njk is converted for Gemini when it has no .gmi.njk
- [ ] #5 A static front page's Markdown can print the author's card and a list of newest posts without overriding markdown-header.md.njk or markdown-footer.md.njk
- [ ] #6 docs/theme/markdown.md and docs/theme/gemini.md describe the layout slots and the lookup order, with a front page example
- [ ] #7 Tests cover a theme layout .md.njk, a theme .gmi.njk for the same layout, the converted fallback, and the unchanged output with no layout template
<!-- AC:END -->
