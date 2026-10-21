---
id: TASK-477
title: Search results and comment pages have a Markdown representation
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
  - packages/cms/src/web/listing-pages.ts
ordinal: 402800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/search/?q= serves HTML and JSON only: Accept text/markdown answers 406 and /search/index.md 404s. A comment permalink (/comment/{key}/) answers Accept text/markdown with 200 HTML and its index.md 404s. Both should have a Markdown representation like every other page, advertised in their Link header.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /search/index.md?q=... and Accept text/markdown on /search/?q=... answer text/markdown listing the results in the listing Markdown shape, with the query and paging
- [ ] #2 A comment permalink answers .md and Accept text/markdown with the comment, its author and date, the post it is on, and its place in the thread as the HTML shows it
- [ ] #3 Both advertise the Markdown alternate in the Link header and are documented in docs/public-site.md; tests cover them
<!-- AC:END -->
