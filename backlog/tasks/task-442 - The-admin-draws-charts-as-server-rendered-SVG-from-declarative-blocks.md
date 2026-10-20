---
id: TASK-442
title: The admin draws charts as server-rendered SVG from declarative blocks
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - admin
  - dashboard
milestone: m-41
dependencies: []
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
priority: medium
ordinal: 379800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, dashboard widgets return declarative blocks and the core writes the markup. Build the blocks and their drawing: stats with an optional change from the previous period, a time series of one or more named series over days, a ranked list (label, value, optional link), a calendar of counts per day, a table and a paragraph. Charts are SVG drawn on the server with DaisyUI colour tokens, and the admin ships no chart library or client chart code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each block type draws from plain data, and invalid input (no points, negative or non-numeric values) draws an empty state instead of throwing
- [ ] #2 A time series with two series draws both with a legend, labelled axes and readable day ticks for 7 and 30 days
- [ ] #3 Every chart has a text or table equivalent a screen reader reaches, and colour is never the only way to tell series apart
- [ ] #4 Charts follow the admin light and dark themes through DaisyUI tokens, with no hard-coded colours
- [ ] #5 A change from the previous period shows its sign and direction in text, not only in colour
- [ ] #6 Blocks are covered by tests that assert on the drawn output
<!-- AC:END -->
