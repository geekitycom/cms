---
id: TASK-145
title: >-
  Default theme CSS: forced colours, touch targets, text wrapping and logical
  properties
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - accessibility
  - theme
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/forced-colors/'
  - 'https://specification.website/spec/accessibility/touch-target-size/'
  - 'https://specification.website/spec/foundations/text-wrap/'
  - 'https://specification.website/spec/i18n/rtl-support/'
priority: low
type: enhancement
ordinal: 169800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme's style.css has no forced-colors rules, no minimum target size, no text-wrap, and mostly physical left/right properties. These are small CSS changes that help Windows High Contrast users, touch users, headline typography, and right-to-left sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Under forced-colors: active, focus rings, buttons and borders stay visible
- [ ] #2 Interactive controls meet the 24x24 CSS px minimum target size
- [ ] #3 Headings use text-wrap: balance and body copy text-wrap: pretty
- [ ] #4 Directional margins, padding and borders use logical properties, and a page with dir=rtl mirrors correctly
- [ ] #5 The default theme sets scrollbar-gutter: stable
<!-- AC:END -->
