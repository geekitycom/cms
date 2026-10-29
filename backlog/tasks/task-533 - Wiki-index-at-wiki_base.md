---
id: TASK-533
title: Wiki index at /<wiki_base>/
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-530
references:
  - decision-66
ordinal: 435800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: /wiki/ shows every wiki page so a reader can browse them. Listings are subjects in src/web/listing-subject.ts, routed by listingAt in src/web/paths.ts; tag archives are the nearest example. A wiki index is short enough to sit on one page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `/<wiki_base>/` lists every published wiki page A to Z by title, grouped by first letter, with no pagination
- [ ] #2 It is served in HTML, .md, .gmi and .json, drawn by a new `wiki-index` layout and its Markdown and Gemini templates in the default theme
- [ ] #3 With no published wiki pages it is a 404
<!-- AC:END -->
