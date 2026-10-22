---
id: TASK-482
title: >-
  Themes can write Gemini templates, and their Markdown templates are converted
  when they do not
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
labels:
  - gemini
  - themes
milestone: m-45
dependencies:
  - TASK-481
references:
  - packages/cms/src/web/render.ts
  - packages/cms/src/theme/themes.ts
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/theme/overriding-a-template.md
ordinal: 407800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Themes may write gemtext chrome directly, as decision-60 describes. Each Gemini slot (header, footer, 404, 410, 500, 503) is looked up in four places, and the first match wins: the chosen theme .gmi.njk; the chosen theme .md.njk rendered and converted by md2gemini; the default theme .gmi.njk; the default theme .md.njk converted. A site theme that customised its Markdown then gets that customisation in Gemini without new work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 partials/gemini-header.gmi.njk, partials/gemini-footer.gmi.njk and layouts/404|410|500|503.gmi.njk are recognised, rendered with the same context as their Markdown counterparts
- [ ] #2 The lookup order above holds; tests cover a theme with a .gmi.njk, a theme with only an overridden .md.njk, and a theme with neither
- [ ] #3 A geminiUrl filter gives a page of the site its .gmi URL and leaves other URLs alone, as markdownUrl does
- [ ] #4 The default theme ships Gemini templates only where converting its Markdown ones reads worse, and the reason is recorded in the task
- [ ] #5 A broken 500 or 503 Gemini template falls back to a fixed body, as the Markdown ones do
- [ ] #6 docs/theme gains a Gemini page next to markdown.md covering the slots, the lookup order, the filter and the context
<!-- AC:END -->
