---
id: TASK-140
title: Speculation rules and cross-document view transitions in the default theme
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - performance
  - theme
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/speculation-rules/'
  - 'https://specification.website/spec/performance/view-transitions/'
priority: low
type: enhancement
ordinal: 164800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public site is server-rendered with almost no JavaScript, which makes it a good fit for speculation rules (prefetch same-origin links a reader is likely to follow) and cross-document view transitions. Both are progressive enhancement: browsers that do not support them ignore them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The default theme emits speculation rules that prefetch same-origin public links with moderate eagerness, and exclude /admin/, feeds, logout and query-string URLs
- [ ] #2 No speculation rules are emitted for a signed-in reader
- [ ] #3 The default theme opts into cross-document view transitions, and disables them under prefers-reduced-motion
- [ ] #4 Themes can turn both off
<!-- AC:END -->
