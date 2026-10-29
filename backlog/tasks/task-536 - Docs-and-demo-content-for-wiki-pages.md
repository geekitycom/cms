---
id: TASK-536
title: Docs and demo content for wiki pages
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T21:06:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-533
  - TASK-534
  - TASK-535
references:
  - decision-66
ordinal: 438800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: operators and theme authors need to know the content type, the link syntax and the new layouts, and the demo should show a small wiki.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/content.md describes wiki pages and the [[link]] syntax with examples; docs/admin.md the Wiki screens; docs/themes.md the `wiki` and `wiki-index` layouts and the `wiki-link` class
- [x] #2 `apps/demo` has a few linked wiki pages, including one link to a missing page
- [x] #3 `pnpm lint` passes, including the doc link check
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read what TASK-529..535 shipped and verify against the code (parser, wiki-link-syntax, wiki layouts, listing-pages, wiki-create, menu, dashboard).
2. docs/content.md: wiki pages section (wiki/<slug>.md, URL from base + file name, ignored keys, drafts/trash, where they appear) and the [[link]] syntax with examples and edge cases; update the type list, permalink table, directory table and scan text.
3. docs/admin.md: route table rows, dashboard tile, menu sections, a Wiki pages section (list, editor fields, new?slug&title prefill) and the editor's wiki link highlighting.
4. docs/themes.md and docs/theme/*: wiki and wiki-index layouts and their context (wikiGroups, updated, backlinks), the wiki-link class, createWikiPage on the 404; layout-template rows in markdown.md and gemini.md; theme README file list; template-context type.
5. Check public-site.md, README index, feeds.md, federation.md, plugins.md, public-api.md for lists of document types or URL families and add wiki where they enumerate.
6. Demo: apps/demo/content/wiki/ with a few linked pages incl. one link to a missing page, and a [[link]] from a demo post; keep test and test:11ty green.
7. Run build, test, test:11ty, typecheck, lint, format:check; boot the demo on a spare port and curl /wiki/ and a page.

8. Scope addition found while building: the demo's Eleventy parity test fails once content/wiki/ exists, because the example Eleventy config built wiki/x.md at /x/. Teach packages/cms/docs/eleventy.config.example.js the wiki permalink rule (/{wikiBase}/{slugified file name}/, overriding front matter) and give the demo a wiki/wiki.json layout file.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Docs: content.md gains Wiki pages (file, URL from base + file name, ignored keys, where a wiki page appears, the wiki index, creating a missing page) and Wiki links (syntax table, slug rules, what is not a link, .md/.gmi output, base change re-render, Eleventy gap); type lists, permalink table, directories table and scan text include wiki/. admin.md: routes, dashboard tile, fourteen menu sections, Wiki pages section, Wiki links in the editor. themes.md: Wiki layouts section. theme/page-shell.md: A wiki page and the wiki index (wiki.njk, wiki-index.njk, wikiGroups, wiki-link class, createWikiPage on the 404). theme/markdown.md and gemini.md: wiki.md.njk / wiki-index.md.njk slots, wikiGroups and type wiki in the context, the default theme's shipped wiki-index templates. template-context.md, theme/README.md, public-site.md (routes, sitemap, llms.txt Wiki section), settings.md (old index 301, re-render), comments.md (wiki pages closed unless comments: true), feeds.md, federation.md (only posts federate), plugins.md (type wiki in hooks and editor actions), public-api.md, eleventy.md, docs/README.md.
Claims checked against code: wiki-link edge cases probed with renderMarkdown (markdown in link text stays literal, [[!!]] and [[#x]] literal, no line break, no brackets, escaped \[[, accents folded); backlinks reader has no type filter; isFederatedDocument is post-only; comment policy openByDefault.wiki = false; llms.txt omits empty sections.
Demo: apps/demo/content/wiki/ with Front matter, Content directory and Permalinks linking each other (one [[Permalinks#Wiki pages|...]] heading link, one [[Representations]] link to a missing page, one [[Permalinks]] in a code span), wiki.json layout file, and [[front matter]] in the Markdown on disk post. Example Eleventy config builds wiki pages at /{wikiBase}/{slug}/.
Verification: pnpm build, test, test:11ty, typecheck, lint (doc links: every link resolves in 52 Markdown files), format:check all exit 0. Demo booted on :3953 from a scratch copy of content/: /wiki/ 200 grouped C/F/P; /wiki/front-matter/ wiki layout with Last updated and backlinks from the post and two wiki pages; heading link /wiki/permalinks/#wiki-pages resolves to id=wiki-pages; /wiki/representations/ 404; index.md, index.gmi and llms.txt Wiki section as documented. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documented wiki pages for operators and theme authors and gave the demo a small wiki. docs/content.md covers the content type, the wiki index, the create button and the [[link]] syntax with examples and edge cases; docs/admin.md the Wiki screens and the editor's link marks; docs/themes.md and docs/theme/* the wiki and wiki-index layouts, wikiGroups, the wiki-link class and createWikiPage; other docs that list document types, routes, sitemap/llms.txt, feeds, federation and plugin types now include wiki pages. apps/demo/content/wiki/ holds three linked pages with one link to a missing page, and a demo post links into the wiki. The example Eleventy config now builds wiki pages at /{wikiBase}/{slug}/ so the demo's Eleventy parity test still holds; Eleventy still prints [[links]] as written and builds no wiki index (documented). All checks pass and the demo was checked with curl.
<!-- SECTION:FINAL_SUMMARY:END -->
