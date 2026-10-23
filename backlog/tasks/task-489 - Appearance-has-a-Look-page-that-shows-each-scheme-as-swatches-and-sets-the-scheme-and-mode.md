---
id: TASK-489
title: >-
  Appearance has a Look page that shows each scheme as swatches and sets the
  scheme and mode
status: To Do
assignee: []
created_date: '2026-10-23 02:12'
labels:
  - admin
  - appearance
milestone: m-46
dependencies:
  - TASK-488
references:
  - packages/cms/admin/pages/appearance/themes.njk
  - packages/cms/admin/components/theme-choice.njk
  - packages/cms/admin/components/setting-fields.njk
ordinal: 414800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: the owner picks a scheme and a mode from the admin. The page draws each scheme the active theme declares as swatches of its own tokens, light and dark, so the choice is seen rather than named, and saves only its own keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Appearance > Look lists every scheme of the active theme as a radio card with its label and swatches (page, text, accent, secondary) for light and dark, drawn with the scheme colours and readable in both admin themes
- [ ] #2 A mode control offers Follow the system, Always light and Always dark; saving writes colorScheme and colorMode and nothing else, and the public site shows the change on the next request
- [ ] #3 A theme with no schemes shows the mode control and a line saying the theme has one palette
- [ ] #4 The page meets the admin keyboard and labelling rules: radios are native, grouped in fieldsets with legends, and the selected card is marked by more than colour
- [ ] #5 Tests cover rendering, saving, a refused value and a theme with no schemes; docs/admin pages that list Appearance mention Look
<!-- AC:END -->
