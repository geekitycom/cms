---
id: TASK-490
title: >-
  A theme declares font roles, and the default theme sets headings and body
  through them
status: To Do
assignee: []
created_date: '2026-10-23 02:12'
labels:
  - theme
  - appearance
  - fonts
milestone: m-46
dependencies: []
references:
  - packages/cms/themes/default/src/style.css
  - packages/cms/themes/default/theme.json
  - packages/cms/src/web/theme-stylesheet.test.ts
ordinal: 415800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: a site can only choose fonts for roles its theme declares. theme.json gains `fonts`, each role with the system stack it falls back to, and the stylesheet reads each role through a `--font-<role>` custom property whose default is that stack. The packaged theme declares heading and body; small labels and code keep their system stacks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 theme.json accepts `fonts`, a map of role to `{ label, fallback }`; the manifest loader validates it and a theme without `fonts` loads as before
- [ ] #2 The packaged theme declares heading and body with the current serif stack as both fallbacks; headings (site title, entry titles, prose h2-h4, reply and reaction headings) use `var(--font-heading)` and body text uses `var(--font-body)`; the sans label and mono code stacks are unchanged
- [ ] #3 With no font chosen the compiled stylesheet renders exactly as before (the tokens default to the current stacks)
- [ ] #4 theme-stylesheet.test.ts checks the role properties exist with their fallbacks and that headings and body read them
- [ ] #5 docs/theme/manifest.md and docs/theme/page-shell.md describe font roles and what a site theme replacing static/style.css must supply
<!-- AC:END -->
