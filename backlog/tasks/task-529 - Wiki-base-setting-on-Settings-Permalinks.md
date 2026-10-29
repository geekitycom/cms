---
id: TASK-529
title: Wiki base setting on Settings > Permalinks
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies: []
references:
  - decision-66
ordinal: 431800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: wiki pages live under a configurable path prefix, the way tag and category archives do. Wiki pages and [[wiki links]] both build their URLs from it, so it comes first. Today `tag_base` and `category_base` are the only permalink settings (src/site/namespace.ts, src/content/taxonomy.ts taxonomyBaseProblems, src/admin/settings-permalinks.ts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `wiki_base` setting with default `wiki` is stored with the other permalink settings and shown on Settings > Permalinks
- [ ] #2 It is checked by the same rules as `tag_base` and `category_base` (pattern, reserved top-level paths), and all three bases have to differ; each problem is named on the field
- [ ] #3 The base reaches the public site view and the content parser, the way the taxonomy bases reach routing
- [ ] #4 The CLI `geekity settings` reads and writes it; the settings-fields golden snapshot is updated
- [ ] #5 docs/settings.md describes it
<!-- AC:END -->
