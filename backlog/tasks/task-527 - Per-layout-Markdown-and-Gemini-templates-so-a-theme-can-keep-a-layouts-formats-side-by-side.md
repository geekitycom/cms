---
id: TASK-527
title: >-
  Per-layout Markdown and Gemini templates, so a theme can keep a layout's
  formats side by side
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T13:46:00Z'
updated_date: '2026-10-29T14:15:00Z'
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
- [x] #1 A theme can add layouts/front-page.md.njk (and the same for post, page, home, author and the other HTML layouts); when it exists, that page's Markdown is built from it
- [x] #2 A layout Markdown template can include the shared header and footer, or leave either out, and has the page's words available to place
- [x] #3 With no layout Markdown template, every page's Markdown and gemtext is byte-identical to today's
- [x] #4 The .gmi page resolves the same slot with the existing four-step lookup, so a theme's layout .md.njk is converted for Gemini when it has no .gmi.njk
- [x] #5 A static front page's Markdown can print the author's card and a list of newest posts without overriding markdown-header.md.njk or markdown-footer.md.njk
- [x] #6 docs/theme/markdown.md and docs/theme/gemini.md describe the layout slots and the lookup order, with a front page example
- [x] #7 Tests cover a theme layout .md.njk, a theme .gmi.njk for the same layout, the converted fallback, and the unchanged output with no layout template
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Capture a baseline of the default theme's .md and .gmi output for posts, pages, listings, search and status pages on a posts homepage and a static one, to compare after the change (AC #3).
2. theme-templates.ts: derive a layout's text templates from its HTML name (layouts/post.njk -> layouts/post.md.njk / layouts/post.gmi.njk) and resolve a slot to the format it is written in with the four-step lookup (shared with the header, footer and status pages).
3. Each text page names its slot chain like its HTML layout: post, page, front page [front-page, page], home, posts page [posts-page, home], tag, category, author, search, comment. Status pages keep their body slots.
4. renderMarkdownChrome takes the chain; when a slot resolves it returns the layout beside the header and footer, written in the layout's format. textPage renders the layout with content (the page's words; on a Gemini page it opens with the Published line), header and footer, instead of the header + words + footer sandwich. A .gmi.njk layout gets gemtext for all three and is written as it is; a .md.njk layout on a Gemini page is converted in one pass.
5. Shared Markdown building blocks: partials/markdown-bio.md.njk (what the header prints today, which the header now includes) and partials/markdown-post-list.md.njk (newestPosts-shaped entries in the listing's line shape).
6. Tests in src/web/layout-markdown.test.ts for every AC; docs in docs/theme/markdown.md and docs/theme/gemini.md with a front page example.
7. Verify build, tests, typecheck, lint, format, and compare against the baseline.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. A layout template replaces the header + words + footer sandwich only when a theme on the search path has the slot; the default theme ships none.

- theme-templates.ts: layoutText() maps layouts/x.njk to layouts/x.md.njk and layouts/x.gmi.njk; slotFormat() is the four-step lookup, now shared by the header, footer, status bodies and layout slots (replaces writesGemtext).
- Slot chains: front page [front-page, page], posts page [posts-page, home], home, post, page, tag, category, author, search, comment. Status pages keep their body slots.
- Context: everything the header/footer get plus content, header and footer. In a .gmi.njk layout all three are gemtext, each converted on its own; in a .md.njk layout they are Markdown and a Gemini page converts the whole output in one pass. On a Gemini page content opens with the Published line.
- New default partials: partials/markdown-bio.md.njk (exactly what the header printed for bio; the header now includes it under not staticFrontPage) and partials/markdown-post-list.md.njk (postList entries in newestPosts shape, listing line shape). Both close their doc comment with -#} because Nunjucks trimBlocks does not trim after comments; without that the header gained a stray newline.
- Byte-identity proof: captured 52 .md/.gmi responses (posts homepage and static homepage + posts page; posts, pages, archive page, tag, category, author, search, 404) from the default theme before the change and compared after; cmp reports identical. The scratch snapshot test was removed afterwards.
- HTTP proof is through cms.app.request in src/web/layout-markdown.test.ts (11 tests); the demo server was not started.

Verification: pnpm build, pnpm test (cms 7802 pass, 0 fail; all workspace packages pass), pnpm test:11ty, pnpm typecheck, pnpm lint (doc links included), pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A theme can now write layouts/<name>.md.njk (and .gmi.njk) for each HTML layout: post, page, front-page, home, posts-page, tag, category, author, search and comment. When the slot resolves, that template writes everything after the front matter, with content (the page's words), header and footer ready to place, and the shared partials includable. With no layout template every page is the header + words + footer it was; a before/after capture of 52 default-theme .md and .gmi responses is byte-identical. Gemini resolves the slot with the existing four-step lookup, so a theme's .md.njk layout is converted where it has no .gmi.njk. New default partials markdown-bio.md.njk (the header now includes it) and markdown-post-list.md.njk let a static front page print the bio and newestPosts without overriding the header or footer. docs/theme/markdown.md and gemini.md describe the slots, lookup order and a front page example. Tests: src/web/layout-markdown.test.ts. Follow-up: TASK-528 changes what markdown-bio.md.njk prints.
<!-- SECTION:FINAL_SUMMARY:END -->
