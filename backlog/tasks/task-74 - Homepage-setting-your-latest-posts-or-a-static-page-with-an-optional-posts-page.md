---
id: TASK-74
title: >-
  Homepage setting: your latest posts or a static page, with an optional posts
  page
status: To Do
assignee: []
created_date: '2026-09-05 14:04'
labels:
  - admin
  - web
  - content
milestone: m-12
dependencies:
  - TASK-73
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/admin/settings.ts
  - packages/cms/docs/eleventy.config.example.js
  - packages/cms/test/eleventy.test.ts
  - /Users/andrewshell/Desktop/Screenshot 2026-09-05 at 9.03.22 AM.png
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 99800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site root is always the latest posts. WordPress's Reading settings let a site choose what the homepage shows: your latest posts, or a static page picked from the published pages, with a second optional pick, the posts page, whose URL then carries the listing. Add the same choice to the Reading settings page (TASK-73) and to site.json as two settings holding page slugs, homepage and postsPage, absent when the site shows its latest posts, so an Eleventy build of the same directory can read them. When a homepage is set, the root renders that page with the page's own template context and a template a theme may override for the front page alone, falling back to the page template, and the page's own permalink answers with a permanent redirect to the root so there is one URL. When a posts page is set, its permalink renders the listing the root used to, paginated under it as {permalink}page/N/, showing the page's title and body above the posts, with a template a theme may override, falling back to the listing template; the feeds stay at /feed/ and its siblings and the posts page advertises them; the root's /page/N/ redirects to the posts page's pagination. A posts page with no homepage set is refused, as WordPress refuses it. If the chosen page is later drafted, trashed or deleted the site falls back to the latest posts and the Reading page says so beside the empty pick; the pages list marks the two pages the way WordPress does. The sitemap and the site menu follow: the homepage is / and the posts page is its own URL. The Eleventy example config honours both settings so the compatibility build shows the same front page and posts page. Reference: the WordPress Reading screen, 'Your homepage displays: Your latest posts / A static page (select below), Homepage, Posts page'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Reading settings page offers Your latest posts or A static page with Homepage and Posts page picks listing published pages; the choice is stored as homepage and postsPage slugs in site.json and absent when latest posts is chosen; a posts page without a homepage is refused with a message
- [ ] #2 With a homepage set, GET / renders that page, its own permalink redirects 301 to /, and a theme can override the front page template with fallback to the page template
- [ ] #3 With a posts page set, its permalink renders the listing with the page's title and body above it, paginated at {permalink}page/N/ with canonical redirects, /page/N/ under the root redirects there, and the feeds stay at /feed/, /feed/atom/ and /feed/json/ and are advertised on it
- [ ] #4 Drafting, trashing or deleting a chosen page falls the site back to latest posts without a 500, and the Reading page shows why the pick is empty; the pages list marks the homepage and the posts page
- [ ] #5 The sitemap lists / once and the posts page at its own URL; the site menu links the posts page when it opts in like any page
- [ ] #6 docs/eleventy.config.example.js honours homepage and postsPage and test/eleventy.test.ts proves an Eleventy build of a site with both set renders the same front page and listing; doc-2, doc-3 and doc-5 describe the setting
<!-- AC:END -->
