---
id: TASK-343
title: A page can have no title
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 13:29'
updated_date: '2026-10-11 13:44'
labels:
  - content
  - themes
dependencies: []
priority: medium
type: enhancement
ordinal: 302800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page must have a title today. The parser refuses a page file without one (`requiredString` for pages in packages/cms/src/content/parser.ts), so the file is never indexed, and the editor refuses to save one ("A page needs a title.", packages/cms/src/admin/documents.ts). A static homepage or a landing page often has no heading of its own, and the default theme already prints the front page h2 only when there is a title (front-page.njk), but a page can never get there.

Andrew, 2026-10-11: titles should be optional for pages, as they already are for posts (a post with no title is a note).

Every place that names a page needs a fallback when it has none: the HTML <title> (the site title, as a homepage), the page layout h1 (left out), JSON-LD and Open Graph names, admin lists and pickers, navigation menu items that point at a page, search results, llms.txt, the sitemap, backlinks and citations (postLabel), the Markdown and JSON representations, and the Eleventy example. Decide the fallback once and use it everywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A page file with no title parses and is served; a page with an empty or missing title is no longer an error
- [x] #2 The editor saves a page with no title (Micropub creates posts only, so it has no page path to change)
- [x] #3 The default theme prints no h1 for an untitled page and no h2 for an untitled static front page; the HTML <title> falls back to the site title
- [x] #4 Every place that names a page (admin lists and pickers, menus, search, JSON-LD, Open Graph, llms.txt, backlinks, citations, representations) has one documented fallback for an untitled page, and none prints an empty name
- [x] #5 The Eleventy example builds an untitled page
- [x] #6 docs/content.md and the theme docs describe untitled pages
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Parser: a page's title is optional like a post's (asString ?? ''); delete requiredString.
2. Editor: drop the 'A page needs a title.' refusal; the slug falls back as a post's does (noteSlug, then 'untitled').
3. One fallback: postLabel (TASK-261) names an untitled page exactly as it names an untitled post (title, first words, Untitled). Use it wherever a page is named by something else: admin list (already), homepage and posts-page pickers (settings-reading pageChoices), front page postsPage link (render.ts), contact message record and spam check (contact/submission.ts), webmention spam-check post title, media 'used by' list, llms.txt and search (already).
4. Where a page names itself it says nothing of its own: page.njk leaves out its h1, front-page.njk its h2 (already), base.njk's pageTitle takes the label only for a post so <title>, og:title and twitter:title fall back to the site title, JSON-LD leaves out headline (already), the Markdown representation adds no heading (already) and the JSON leaves out title (already). An untitled posts page's listing title falls back to the site title (routes.ts).
5. Menus keep their own Label | URL; test that an item pointing at an untitled page renders and the menu editor shows it.
6. Eleventy: page.njk guard covers it; test:11ty builds an untitled page and an untitled front page.
7. Micropub creates only posts (h-entry/h-event) and refuses a page URL on update; no page creation path exists. Report it.
8. Docs: docs/content.md and the theme docs describe untitled pages.
9. Tests first per AC; verify on a served scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One fallback: postLabel (TASK-261) names an untitled page exactly as it names an untitled post (title, first ten words, Untitled). No page-specific label (operator directive). Where a page names itself it prints no name: page.njk leaves out the h1, front-page.njk the h2, base.njk takes the label for the head only on a post so <title>/og:title/twitter:title are the site title alone, JSON-LD Article has no headline, index.md adds no heading, index.json has no title. An untitled posts page's listing title is the site title (routes.ts, was an empty h1 and '# ' in Markdown). Everything that links to or lists a page uses the label: admin lists (already), editor heading and flashes (already), homepage/posts-page picks (settings-reading, was document.title), front page postsPage link (render.ts), media 'used by' (was the file path), contact message record and spam check, webmention spam-check post title, the per-entry comments feed <link> title in base.njk (was 'Comments on: ' with nothing after it), search, llms.txt, backlinks, oEmbed (already). Menus unchanged: items keep their own Label | URL; a test proves an item pointing at an untitled page renders its own label and the menu editor shows it as stored.
Deleted: parser requiredString and the page-only title rule; the editor's 'A page needs a title.' refusal; the tests asserting both (parser, pages, editor-layout); sync test now indexes the untitled page.
AC #2 left open: Micropub has no page path. create.ts accepts h-entry and h-event and writes POST_KIND only; update refuses a URL that is not a post ('is not a post on this site'). The editor part holds (test: saves a page with no title). Making Micropub create pages needs a vocabulary decision (no Micropub spec property names a page) and is new scope.
Tests: src/web/untitled-page.test.ts (10 cases: served, head, front page, posts page, admin lists match posts, picks, menu, search/llms/backlinks, md/json, editor save), parser and sync tests, test/eleventy.test.ts builds an untitled about and front page with the default theme. Mutation checks: reverting the picks, base.njk, routes.ts and page.njk changes each fails its test; reverting page.njk fails test:11ty.
Scratch site (scratchpad/t343, port 3433, stopped): /about/ and / both <title>A Geekity site</title>, og/twitter title the site title, no h1 on /about/, no h2 on /, JSON-LD Article with no name or headline; /admin/pages lists 'I write software in Ohio and keep notes here.' and 'Welcome to the site.' as /admin/posts lists titles; reading picks show the same labels; /admin/navigation shows 'About | /about/'; search and llms.txt name the page by its label; /about/index.md has no heading and index.json no title; hello's backlinks list the page by its label; no empty <title>, h1-h3 or content="" on /, /about/, a post or search.
Validation: pnpm build, pnpm test (cms 5451 pass), pnpm typecheck, pnpm lint, pnpm format:check all exit 0; pnpm test:11ty 23 pass.
<!-- SECTION:NOTES:END -->
