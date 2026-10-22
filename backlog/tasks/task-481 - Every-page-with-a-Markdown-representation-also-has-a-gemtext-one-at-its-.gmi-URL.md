---
id: TASK-481
title: >-
  Every page with a Markdown representation also has a gemtext one at its .gmi
  URL
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
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
- [ ] #1 A post, a page and the homepage answer /x/index.gmi with text/gemini; charset=utf-8, and /x.gmi answers 301 to it with the query kept, as .md does
- [ ] #2 Links in the body and the chrome that name a page of the site point at its .gmi URL, through the same resolver as markdownHrefFor; links elsewhere are left alone
- [ ] #3 Listings (latest posts, posts page, tags, categories, author archives, date archives, the archive page) answer .gmi with gemfeed lines => url YYYY-MM-DD title, plus pagination links
- [ ] #4 Search and comment pages answer .gmi
- [ ] #5 A .gmi request that ends in 404, 410, 500 or 503 keeps its status and gets a gemtext body
- [ ] #6 Accept: text/gemini selects the representation; the Link header advertises the .gmi alternate; the 406 body lists it
- [ ] #7 The gemtext is good: no front matter, no leftover Markdown markup, every link on its own => line; checked on real pages of the demo site
- [ ] #8 doc-3, docs/public-site.md and tests cover the representation
<!-- AC:END -->
