---
id: TASK-419
title: A short breadcrumb link has no extra gap after it
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-16 03:28'
updated_date: '2026-10-16 12:26'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/themes/default/src/style.css
priority: low
ordinal: 374800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a post filed under a short category such as AI, the breadcrumb reads 'Home > AI    > Post title…': the gap after AI is about twice the gap after Home. The default theme gives .breadcrumbs a links min-inline-size: 24px (a target-size minimum) and display: inline-flex, and the link text starts at the left of that box. 'AI' is narrower than 24px, so the rest of the box shows as extra space before the next separator. Any term or page name narrower than 24px does the same. Proposal: keep the 24px target, and centre the text in it (justify-content: center), or reach the size with padding split evenly on both sides, so the gaps between crumbs look the same.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a post whose breadcrumb has a two-letter category, the space on either side of each separator looks the same as it does after Home
- [ ] #2 Every breadcrumb link is still at least 24 by 24 CSS pixels
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add justify-center to .breadcrumbs a so a crumb narrower than the 24px target centres its text.
2. Verify in a browser: equal gaps around separators after a two-letter category, every crumb link still at least 24x24.
<!-- SECTION:PLAN:END -->
