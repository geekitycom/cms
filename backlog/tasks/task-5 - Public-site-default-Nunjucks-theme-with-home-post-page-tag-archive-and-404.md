---
id: TASK-5
title: >-
  Public site: default Nunjucks theme with home, post, page, tag archive, and
  404
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 13:38'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-4
references:
  - backlog/decisions/decision-4 - Nunjucks-templates-for-theme-and-admin.md
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Render the public site from the index using Nunjucks (decision-4). Ship the default theme inside packages/cms/themes/default with a base layout, home listing with pagination, single post, single page, tag archive, and 404. Template lookup checks the site theme directory first and falls back to the package default file by file (decision-6). Template context for a document mirrors what an Eleventy layout receives (title, date, tags, content, page.url). Trailing-slash canonicalisation redirects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET / lists published posts newest first with pagination links at /page/2/
- [ ] #2 GET on a post permalink renders title, date, tags, and body HTML through the theme
- [ ] #3 GET on a page permalink renders the page template
- [ ] #4 GET /tags/{tag}/ lists posts with that tag
- [ ] #5 Drafts return 404 on the public site
- [ ] #6 A request without a trailing slash redirects 301 to the canonical URL
- [ ] #7 Theme static assets are served from /theme/ with cache headers
- [ ] #8 A site theme/ directory containing only layouts/post.njk overrides the post template while every other template still comes from the package default
<!-- AC:END -->
