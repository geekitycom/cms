---
id: TASK-146
title: 'Head metadata: theme-color, color-scheme and richer Open Graph'
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
  - theme
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/foundations/theme-color/'
  - 'https://specification.website/spec/foundations/color-scheme/'
  - 'https://specification.website/spec/foundations/open-graph/'
priority: medium
type: enhancement
ordinal: 170800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme emits Open Graph and a summary Twitter card. It has no theme-color, and it declares color-scheme only in CSS, so dark-mode readers see a white flash before the stylesheet loads. og:image:alt and the article:* times are missing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 base.njk emits meta color-scheme matching the theme, and theme-color for light and dark from theme.json
- [ ] #2 Posts emit article:published_time, article:modified_time, article:author and article:tag
- [ ] #3 og:image:alt is emitted whenever og:image is, using the image's alt text
- [ ] #4 Twitter card uses summary_large_image when the image is large enough
<!-- AC:END -->
