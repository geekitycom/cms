---
id: TASK-468
title: The archive page's Markdown lists its posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 17:16'
updated_date: '2026-10-21 18:34'
labels: []
milestone: m-43
dependencies: []
priority: medium
ordinal: 402800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page with archive: true lists every published post by month in its HTML, from archiveMonths. Its Markdown representation (index.md, or Accept: text/markdown) has only the page's front matter, its own body and the theme's header and footer, so the posts are missing. The Markdown context has no archiveMonths, so a site theme can't add them either. A Markdown browser or a language model that follows the archive link in the menus finds an empty page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Markdown of an archive: true page lists every published post under the page's own Markdown, grouped by month, newest first, matching the HTML
- [x] #2 Each post is one line, in the shape a listing's Markdown already uses: [date title](url.md): description
- [x] #3 The Markdown header and footer partials get archiveMonths, so a theme can override the layout
- [x] #4 docs/public-site.md and docs/theme/markdown.md describe the archive page's Markdown
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in packages/cms/src/web/markdown-representation.test.ts: the default Markdown of an archive: true page lists the months under the body, one entry line each in the entryList shape; a plain page lists nothing; a site theme's header and footer both get archiveMonths.
2. renderMarkdownChrome takes the document being rendered; when archiveOpen(document) it adds archiveMonths to the partial context as Markdown data: { month, posts: [{ label, url, date: YYYY-MM-DD in the site zone, description (one line) }] }, built from the same archiveMonths() the HTML uses (ArchiveEntry gains description).
3. The default markdown-footer.md.njk prints the months first, as ## Month headings over the entry lines, then its existing site heading and links.
4. Document it in docs/public-site.md (The Markdown) and docs/theme/markdown.md (context table, default partials).
5. Run the full check suite and curl /archive/index.md on the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
renderMarkdownChrome now takes the document the Markdown is of. When it says archive: true, the partial context gets archiveMonths as Markdown data: { month, posts: [{ label, url, date (YYYY-MM-DD in the site zone), description (one line, absent when none) }] }, built from the same archiveMonths() the HTML page uses, so the months and order cannot drift. ArchiveEntry gained an optional description for this. The default markdown-footer.md.njk prints the months first (## Month, then entry lines in the entryList shape), then its existing heading and links; a site theme's header or footer can lay it out its own way. Nunjucks trimBlocks eats the newline after a block tag, so the optional ': description' is an inline expression, not an if block.
Docs: docs/public-site.md (The Markdown: footer row and an archive example), docs/theme/markdown.md (context table row, entry shape, default footer), docs/theme/page-shell.md (posts shape gains description, link to the Markdown), docs/content.md (one line pointing at the Markdown).
Verification: three new tests in packages/cms/src/web/markdown-representation.test.ts (default output by month with an escaped title and a joined description, draft absent, titles equal the HTML archive's in order; a plain page lists nothing; a site theme's header and footer both get archiveMonths). pnpm build, test, test:11ty, typecheck, lint, format:check all pass. Demo: curl /archive/index.md and Accept: text/markdown on /archive/ list 5 posts under June-September 2026 headings, the same 5 the HTML /archive/ lists; /about/index.md lists none.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An archive: true page's Markdown now lists every published post after the page's own Markdown, grouped by month, newest first, one '[YYYY-MM-DD Title](url.md): description' line each, matching the HTML archive. The Markdown header and footer partials get archiveMonths as Markdown data so a site theme can lay it out; the default footer prints it. Docs updated in public-site.md, theme/markdown.md, theme/page-shell.md and content.md. Verified with three new tests in markdown-representation.test.ts, the full check suite, and curl against the demo's /archive/index.md.
<!-- SECTION:FINAL_SUMMARY:END -->
