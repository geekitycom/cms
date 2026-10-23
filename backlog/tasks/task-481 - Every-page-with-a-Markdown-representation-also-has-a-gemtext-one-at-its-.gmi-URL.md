---
id: TASK-481
title: >-
  Every page with a Markdown representation also has a gemtext one at its .gmi
  URL
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 16:51'
labels:
  - gemini
  - public-site
milestone: m-45
dependencies:
  - TASK-480
references:
  - packages/cms/src/web/negotiate.ts
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/src/web/markdown-page.ts
  - packages/cms/src/web/routes.ts
  - docs/public-site.md
ordinal: 406800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add gemini as a representation next to markdown (decision-60, doc-3). It is served over HTTP at a .gmi URL with text/gemini and built from the same data as the Markdown: the stored body converted by @geekity/md2gemini, and the chrome (title, date, home, previous, next, byline, menus, feeds) written as heading and link lines instead of front matter. Links to the site own pages point at their .gmi through the same resolver that gives .md. This task uses built-in chrome only; theme templates come in a later task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post, a page and the homepage answer /x/index.gmi with text/gemini; charset=utf-8, and /x.gmi answers 301 to it with the query kept, as .md does
- [x] #2 Links in the body and the chrome that name a page of the site point at its .gmi URL, through the same resolver as markdownHrefFor; links elsewhere are left alone
- [x] #3 Listings (latest posts, posts page, tags, categories, author archives, date archives, the archive page) answer .gmi with gemfeed lines => url YYYY-MM-DD title, plus pagination links
- [x] #4 Search and comment pages answer .gmi
- [x] #5 A .gmi request that ends in 404, 410, 500 or 503 keeps its status and gets a gemtext body
- [x] #6 Accept: text/gemini selects the representation; the Link header advertises the .gmi alternate; the 406 body lists it
- [x] #7 The gemtext is good: no front matter, no leftover Markdown markup, every link on its own => line; checked on real pages of the demo site
- [x] #8 doc-3, docs/public-site.md and tests cover the representation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core depends on @geekity/md2gemini (workspace:^); Dockerfile copies and builds md2gemini before core; pack-install-smoke packs it so a packed core resolves it.
2. negotiate.ts: 'gemini' joins Representation with text/gemini, the .gmi extension and text/gemini; charset=utf-8; it is in the document, listing and comment lists after markdown, so the Link header, the 406 body, Accept selection and the .gmi/301 handling in resolveRequest all pick it up from the tables. Inline disposition like Markdown.
3. markdown-representation.ts: the link resolver (markdownHrefFor) takes the representation, so .md and .gmi links come from one resolver. Each builder (document, listing, search, comment, status) takes a text format (markdown or gemini) and builds the same chrome and blocks; a gemini page is the theme's Markdown header and footer rendered with .gmi links, the body with its site links rewritten to .gmi, converted by md2gemini (plain, stripHtml), and the front matter's date and home written as lines instead. Entry lists in gemini drop descriptions so they convert to gemfeed lines (=> url YYYY-MM-DD title); the archive page's months do the same.
4. md2gemini: a paragraph that is one link and nothing else becomes a bare => line, so chrome lines such as 'Written by' read as links rather than footnotes.
5. Call sites (document-page, listing-pages, feed-routes comment page, status-pages, maintenance, server-error) branch on one helper mapping representation to text format; routes add /comment/:id/index.gmi and /search/index.gmi.
6. Tests first per AC (gemini-representation.test.ts plus updates to Link/406 expectations), then docs: doc-3 via backlog doc update, docs/public-site.md.
7. Verify with the full suite and curl against the demo site on a spare port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: gemini joins the Representation tables in negotiate.ts (text/gemini, .gmi, charset utf-8, in the document, listing and comment lists after markdown), so Accept selection, the Link header, the 406 body, the .gmi/301 spellings, redirect_from and the status pages all come from the tables. textFormatOf maps a representation to the format its body is written in (markdown for markdown and text, gemini for gemini) and every call site branches on it.

The Markdown builders take that format. The link resolver (formerly markdownHrefFor, now siteHrefFor) takes it too, so .md and .gmi come from one resolver; the body is rewritten with rewriteMarkdownLinks before conversion rather than through md2gemini's rewriteLink, so the chrome's comment-form link (an absolute URL to the HTML page) is not turned into a .gmi. A gemini page is the theme's Markdown header and footer drawn with .gmi links, plus the blocks, converted once by md2gemini (plain, stripHtml) so footnote numbers run through the whole page. Front matter is replaced by a 'Published YYYY-MM-DD' line under the header for a dated document and a closing '=> /index.gmi Home' unless the page already has that line.

Gemfeed: entry lists in gemini drop descriptions and search snippets (renderMarkdownChrome gets gemfeed: true for the archive page's months), so md2gemini's link-list rule writes => url YYYY-MM-DD title. A gemfeed reader would otherwise read the description as part of the title.

md2gemini gained one rule: a top-level paragraph that is one link and nothing else becomes a bare => line (README updated, three tests). Without it the byline and the 'Leave a comment' lines came out as numbered footnotes.

'Built-in chrome' read as: no Gemini templates yet. The header and footer are the theme's Markdown partials converted, which is steps 2 and 4 of decision-60's lookup; TASK-482 adds the .gmi.njk steps and the geminiUrl filter on top.

AC #3 names date archives; the CMS has none (listing subjects are home, term and author), so there is nothing to cover there.

Packaging: core depends on @geekity/md2gemini workspace:^. Dockerfile copies and builds md2gemini before core; docker build succeeded and the image imports @geekity/md2gemini (image removed after). scripts/pack-install-smoke.sh packs md2gemini and appends a pnpm override to the scaffolded site's pnpm-workspace.yaml; the smoke run passed. release.test.ts now expects md2gemini then core first in the release order.

Validation: pnpm build && pnpm test (core 7380, md2gemini 54, all packages 0 fail) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass. New src/web/gemini-representation.test.ts (20 tests, AC #1-#6). Existing Link/406 expectations and the anonymous-pages golden gained the .gmi alternate only. Demo site on port 3481: a crawler from /index.gmi followed every local => link, 30 pages (29 x 200, one deliberate 404), all text/gemini, no front matter, no inline links or markup outside preformatted blocks, every => line well formed, no .md links. curl showed Accept: text/gemini, the Link header, the 406 body, the 301 short spelling and a 404 by Accept. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gemtext is a fourth representation: every post, page, listing, search, comment page and status page answers at its .gmi URL and by Accept: text/gemini with text/gemini; charset=utf-8, and the Link header and 406 body advertise it. It is the page's Markdown (theme header and footer, body with site links resolved to .gmi by the same resolver as .md) converted by @geekity/md2gemini, with front matter replaced by a date line and a home link, and listings written as gemfeed lines. md2gemini now writes a lone-link paragraph as one => line. Core depends on md2gemini; the Dockerfile and the pack-install smoke build and pack it. Verified by the full build/test/typecheck/lint/format chain, 20 new tests, a crawl of 30 demo pages, curl against the demo, docker build and the pack-install smoke. doc-3 and docs/public-site.md describe it.
<!-- SECTION:FINAL_SUMMARY:END -->
