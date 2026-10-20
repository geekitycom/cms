---
id: TASK-456
title: The dashboard lists Umami top pages and referrers
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
labels:
  - plugins
  - umami
  - dashboard
milestone: m-42
dependencies:
  - TASK-454
  - TASK-444
priority: medium
ordinal: 393800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two ranked lists for the last 7 days: top pages and top referrers. A page path that matches a post links to that post in the editor, which ties traffic back to content.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Top pages lists the ten most viewed paths with views, and a path that matches a post shows the post title and links to its editor
- [ ] #2 Top referrers lists the ten biggest referring domains with visitors, and the site own domain is left out
- [ ] #3 Both lists handle an empty week with a short empty state
<!-- AC:END -->
