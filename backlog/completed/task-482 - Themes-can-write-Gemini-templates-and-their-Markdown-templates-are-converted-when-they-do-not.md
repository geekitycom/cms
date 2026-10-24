---
id: TASK-482
title: >-
  Themes can write Gemini templates, and their Markdown templates are converted
  when they do not
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 17:03'
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
- [x] #1 partials/gemini-header.gmi.njk, partials/gemini-footer.gmi.njk and layouts/404|410|500|503.gmi.njk are recognised, rendered with the same context as their Markdown counterparts
- [x] #2 The lookup order above holds; tests cover a theme with a .gmi.njk, a theme with only an overridden .md.njk, and a theme with neither
- [x] #3 A geminiUrl filter gives a page of the site its .gmi URL and leaves other URLs alone, as markdownUrl does
- [x] #4 The default theme ships Gemini templates only where converting its Markdown ones reads worse, and the reason is recorded in the task
- [x] #5 A broken 500 or 503 Gemini template falls back to a fixed body, as the Markdown ones do
- [x] #6 docs/theme gains a Gemini page next to markdown.md covering the slots, the lookup order, the filter and the context
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a theme text slot names its two templates, { markdown: '...md.njk', gemini: '...gmi.njk' }; a rendered slot is { format, text } where format says whether the theme wrote gemtext or Markdown.
2. render.ts: CHROME slots (header, footer) and STATUS_PAGES gain gemini names. One lookup walks themes.current().dirs and in each dir takes .gmi.njk then .md.njk (findThemeFile), so the order is chosen .gmi, chosen .md, default .gmi, default .md. renderMarkdownChrome and renderStatusMarkdown take a format and return the slot's { format, text }. Same context for both. A geminiUrl filter reads the context's geminiUrl writer, as markdownUrl does.
3. markdown-representation.ts textPage: Markdown slots are converted in ONE convert pass; gemtext slots are spliced in unconverted at placeholder paragraphs, so [n] link numbers run through every converted part and a theme's own => lines carry none.
4. Tests first (new gemini-templates.test.ts): theme with .gmi.njk, theme with only .md.njk overridden, theme with neither, default .gmi beating chosen-none, geminiUrl filter, broken 500/503 .gmi.njk falling back to the fixed body.
5. Default theme: compare converted output of each slot and ship .gmi.njk only where conversion reads worse; record why in notes.
6. docs/theme/gemini.md beside markdown.md (slots, lookup order, filter, context); link from docs/theme README and markdown.md.
7. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; curl the demo .gmi pages.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. render.ts: a slot is TextTemplates { markdown, gemini }; renderMarkdownChrome({format}) and renderStatusMarkdown({format}) return ThemeText { format, text }. writesGemtext walks themes.current().dirs taking .gmi.njk then .md.njk per dir, so the order is chosen .gmi, chosen .md, default .gmi, default .md; Nunjucks then resolves the same file because it walks the same dirs. The gemfeed option became format. geminiUrl is a filter beside markdownUrl that reads a geminiUrl writer from the context; on Gemini renders both markdownUrl and geminiUrl give .gmi URLs, on Markdown renders geminiUrl leaves URLs alone.

[n] numbering decision (the TASK-481 caveat): markdown-representation.ts gemtextOf converts every Markdown part in ONE convert pass and stands a theme's gemtext in that pass as a placeholder paragraph (geekity-gemtext-<uuid>-<i>), then puts it back unconverted. So link numbers run through the whole page even when a gemtext status body sits between a Markdown header and footer, and a theme's own => lines carry no numbers. Tested in gemini-templates.test.ts ('numbers the converted links through the page around a gemtext body').

AC#4 decision: the default theme ships layouts/404|410|500|503.gmi.njk only. Converting their Markdown ends each page with 'Go home[1], or search the site[2].' over two numbered link lines labelled with the URL; the Gemini bodies write the sentence then '=> /index.gmi Home' and '=> /search/index.gmi Search the site'. The Home line matches the page's closing home link, so the page does not repeat it. The default header and footer convert well (lists of links become bare link lines, a lone-link byline becomes a bare line), so no Gemini header or footer ships.

Validation: pnpm build && pnpm test (cms 7389 pass, md2gemini 54, plugins pass) && pnpm test:11ty (23 + 8 pass) && pnpm typecheck && pnpm lint (doc links: 51 files resolve) && pnpm format:check all pass. Demo on port 3917: /nope/index.gmi answers 404 text/gemini with the Gemini body and link lines; /nope/index.md still has the Markdown sentence; stopped by PID.

Note for review: Renderer is exported from src/web/index.ts, and renderMarkdownChrome/renderStatusMarkdown now return ThemeText instead of string, and MARKDOWN_TEMPLATES (never re-exported) became the private CHROME_TEMPLATES.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Themes can write gemtext chrome: partials/gemini-header.gmi.njk, partials/gemini-footer.gmi.njk and layouts/404|410|500|503.gmi.njk, rendered with their Markdown counterparts' context. Each Gemini slot is the chosen theme's .gmi.njk, else its .md.njk converted, else the default theme's .gmi.njk, else its .md.njk converted (decision-60). A geminiUrl filter gives the site's pages their .gmi URL and leaves other URLs alone. Gemtext slots are spliced into the page unconverted while every Markdown part converts in one pass, so [n] link numbers run through the page. The default theme ships Gemini bodies for the four status pages only, because their converted Markdown ends in footnoted links. A broken 500/503 .gmi.njk falls back to the fixed body. New docs/theme/gemini.md covers slots, lookup order, filter and context. Verified with gemini-templates.test.ts (9 tests over .gmi, .md-only and neither themes, numbering, fallback), the full build/test/test:11ty/typecheck/lint/format:check run, and curl against the demo on port 3917.
<!-- SECTION:FINAL_SUMMARY:END -->
