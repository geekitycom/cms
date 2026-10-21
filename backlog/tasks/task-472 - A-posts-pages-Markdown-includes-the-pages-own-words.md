---
id: TASK-472
title: A posts page's Markdown includes the page's own words
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
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
ordinal: 397800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With a postsPage set, the HTML listing at that page's permalink draws the page's own rendered body above the posts (home.njk, listing-subject.ts). Its Markdown (index.md or Accept: text/markdown) has only the title, the description quote and the post list: listingMarkdown never reads the page document, so the page's words are lost. Page 2 onward should behave as the HTML does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Markdown of the posts page prints the page's own Markdown body, with its site links pointing at .md, after the heading and description and before the post list
- [ ] #2 Paginated pages of the posts page match the HTML: the body appears where the HTML shows it and not where it doesn't
- [ ] #3 Tests cover the posts page Markdown, and docs/public-site.md describes it
<!-- AC:END -->
