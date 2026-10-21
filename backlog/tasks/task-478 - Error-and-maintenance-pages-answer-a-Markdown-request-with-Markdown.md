---
id: TASK-478
title: Error and maintenance pages answer a Markdown request with Markdown
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
  - packages/cms/src/web/request.ts
ordinal: 403800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
404, 410, 500 and the 503 maintenance page always answer with HTML. A Markdown client (a .md URL or Accept text/markdown) gets an HTML body and loses the hint the HTML gives: a link home, search, and the 503's back-by time. They should answer such a request with a short text/markdown body and the same status.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A .md URL or Accept text/markdown that ends in 404, 410, 500 or 503 gets text/markdown with the same status code
- [ ] #2 The body says what happened, as the HTML does, links home and to search, and the 503 gives its back-by time when there is one
- [ ] #3 The theme can override the Markdown error body, it is documented, and tests cover each status
<!-- AC:END -->
