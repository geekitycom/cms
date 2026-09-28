---
id: TASK-143
title: 'Admin: skip link, visible focus styles and table captions'
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - accessibility
  - admin
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/skip-links/'
  - 'https://specification.website/spec/accessibility/focus-indicators/'
  - 'https://specification.website/spec/accessibility/focus-not-obscured/'
  - 'https://specification.website/spec/accessibility/data-tables/'
priority: medium
type: enhancement
ordinal: 167800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public theme has a skip link and :focus-visible styles, but the admin does not. Keyboard users tab through the full admin menu on every screen, and focus indicators mostly depend on the browser default, which is weak against the admin's colours. Admin tables use th scope but have no caption.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every admin screen has a skip-to-main link as its first focusable element
- [ ] #2 Every interactive admin control shows a :focus-visible indicator that meets 3:1 contrast
- [ ] #3 A focused control is never hidden under the sticky admin bar
- [ ] #4 Every admin data table has a caption (visually hidden where the heading already says the same)
<!-- AC:END -->
