---
id: TASK-488
title: 'The site chooses a colour scheme and a mode, and every page applies them'
status: To Do
assignee: []
created_date: '2026-10-23 02:12'
labels:
  - theme
  - appearance
  - settings
milestone: m-46
dependencies:
  - TASK-487
references:
  - packages/cms/src/site/namespace.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/web/page-shell.test.ts
ordinal: 413800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: two SITE settings, colorScheme and colorMode, pick one of the active theme schemes and whether it follows the system, is always light or always dark. The page shell prints them so the stylesheet applies them, and keeps the color-scheme and theme-color meta tags in step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `colorScheme` (optional text, empty means the active theme first scheme) and `colorMode` (one of system, light, dark; default system) are SITE settings with descriptions, env overrides and checks; colorScheme is checked against the active theme
- [ ] #2 Every HTML page prints `data-scheme` and `data-mode` on `<html>`; a scheme the active theme does not declare falls back to its first, so switching themes never breaks a page
- [ ] #3 The color-scheme meta is `light dark`, `light` or `dark` to match the mode, and theme-color meta tags print the chosen scheme values, one per mode that can show
- [ ] #4 The embed view and the error pages apply the same scheme and mode
- [ ] #5 Tests cover each mode, a fallback scheme, a theme without schemes, and the meta tags
- [ ] #6 docs/settings.md and docs/theme/page-shell.md document both settings
<!-- AC:END -->
