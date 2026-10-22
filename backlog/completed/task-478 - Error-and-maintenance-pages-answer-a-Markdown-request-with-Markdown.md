---
id: TASK-478
title: Error and maintenance pages answer a Markdown request with Markdown
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 01:26'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/src/web/request.ts
ordinal: 403800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
404, 410, 500 and the 503 maintenance page always answer with HTML. A Markdown client (a .md URL or Accept text/markdown) gets an HTML body and loses the hint the HTML gives: a link home, search, and the 503's back-by time. They should answer such a request with a short text/markdown body and the same status.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A .md URL or Accept text/markdown that ends in 404, 410, 500 or 503 gets text/markdown with the same status code
- [x] #2 The body says what happened, as the HTML does, links home and to search, and the 503 gives its back-by time when there is one
- [x] #3 The theme can override the Markdown error body, it is documented, and tests cover each status
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first: a Markdown 404 and 410 by .md URL and by Accept (text/markdown, text/plain) with the same status; HTML stays the answer for no Accept, */* and an HTML-preferring Accept; the body says what happened and links home and search as .md; the 500 and 503 bodies come from the theme, the 503 with its back-by time; a site theme's layouts/{404,410,500,503}.md.njk replaces each body; a failing Markdown template falls back to the fixed body for 500/503.
2. Per-status Markdown templates beside the HTML ones: layouts/404.md.njk, 410.md.njk, 500.md.njk, 503.md.njk in the default theme, rendered by the Markdown environment (autoescape off, theme search path), with title, url, until/untilText and the markdownUrl filter.
3. Renderer.renderStatusMarkdown(page, context) in render.ts; statusMarkdown(c, page, until) in markdown-representation.ts builds the page with markdownPage (front matter title + home, the theme's header and footer, chrome type 'status').
4. notFound/gone in request.ts read the representation with representationOf (suffix, then Accept, else HTML) and answer markdown/text with the same status, Vary: Accept and Content-Disposition: inline; JSON and HTML stay HTML as before. server-error.ts and maintenance.ts use statusMarkdown with their fixed body as the fallback; 503 keeps Retry-After and no-store.
5. Docs: docs/theme/markdown.md (status templates and context), docs/theme/README.md tree, docs/public-site.md and doc-3 status line.
6. pnpm build, test, test:11ty, typecheck, lint, format:check; curl the scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. notFound and gone moved from request.ts to the new src/web/status-pages.ts, because the Markdown body needs markdown-representation.ts, which imports request.ts; the seven importers now take them from status-pages.ts. statusPage there picks the representation with representationOf (the .md suffix, then Accept, else HTML) and answers markdown/text through statusMarkdownResponse, which server-error.ts and maintenance.ts use too, with their old fixed Markdown bodies as the fallback when the theme's template throws. A 404/410 asked for as JSON still gets the HTML page, as before.
Theming: per-status Markdown templates beside the HTML layouts, layouts/404.md.njk, 410.md.njk, 500.md.njk and 503.md.njk, rendered by the Markdown environment (autoescape off, theme search path) via Renderer.renderStatusMarkdown. The page is markdownPage with chrome type 'status' (added to MarkdownChrome), so the theme's header writes the title and its footer the feeds and navigation. Front matter is title and home, plus until (ISO) on a 503 with a future back-by time.
The HTML 404 and 410 now carry Vary: Accept, since the same URL can answer Markdown; the admin-bar golden file was regenerated for that and the diff is only the vary header on the notFound entries.
Verified: src/web/status-markdown.test.ts (13 tests, each status by .md and by Accept, text/plain, HTML for no Accept, */*, a browser Accept, image/png and .json, theme override of each body and of header/footer, fallback for 500/503); server-error.test.ts updated for the new body. pnpm build, test (cms 6600 pass), test:11ty, typecheck, lint, format:check all pass. Curled the scratch site (a copy at scratchpad/site-status on port 3473 with a trashed post, a header that throws on posts, and data/maintenance.json): 404 .md and Accept text/markdown/text/plain answer Markdown 404, no Accept, */* and text/html,text/markdown;q=0.9 answer HTML 404; trashed post .md answers Markdown 410; a post .md whose header throws answers Markdown 500 with no-store; maintenance with until answers Markdown 503 with Retry-After as the HTTP date and the back-by sentence, without until Retry-After 600 and no time. Servers stopped.
Docs: docs/theme/markdown.md (Status pages section, template table, type), docs/theme/README.md tree, docs/public-site.md, doc-3.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
404, 410, 500 and 503 answer a .md URL, or an Accept that prefers text/markdown or text/plain, with a Markdown body and the same status: the theme's layouts/{404,410,500,503}.md.njk between the Markdown header and footer, saying what happened as the HTML does, linking home and search, and giving the 503's back-by time (also in front matter as until). Default, */* and HTML-preferring requests still get HTML. notFound/gone moved to src/web/status-pages.ts; 500/503 keep their fixed Markdown as the fallback. Documented in docs/theme/markdown.md, docs/public-site.md and doc-3. Verified with status-markdown.test.ts, the full pnpm build/test/test:11ty/typecheck/lint/format:check run, and curl against a scratch site for each status.
<!-- SECTION:FINAL_SUMMARY:END -->
