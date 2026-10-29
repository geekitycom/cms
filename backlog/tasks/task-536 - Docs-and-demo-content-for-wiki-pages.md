---
id: TASK-536
title: Docs and demo content for wiki pages
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
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
- [ ] #1 docs/content.md describes wiki pages and the [[link]] syntax with examples; docs/admin.md the Wiki screens; docs/themes.md the `wiki` and `wiki-index` layouts and the `wiki-link` class
- [ ] #2 `apps/demo` has a few linked wiki pages, including one link to a missing page
- [ ] #3 `pnpm lint` passes, including the doc link check
<!-- AC:END -->
