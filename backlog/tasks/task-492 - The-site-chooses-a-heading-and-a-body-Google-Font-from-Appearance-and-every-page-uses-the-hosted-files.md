---
id: TASK-492
title: >-
  The site chooses a heading and a body Google Font from Appearance, and every
  page uses the hosted files
status: To Do
assignee: []
created_date: '2026-10-23 02:13'
labels:
  - fonts
  - appearance
  - admin
  - settings
milestone: m-46
dependencies:
  - TASK-489
  - TASK-490
  - TASK-491
references:
  - packages/cms/src/site/namespace.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/admin/headers.ts
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: two SITE settings, headingFont and bodyFont, pick a Google Fonts family per font role or empty for the theme stack. Saving downloads the family through the font store first and is refused if the family lacks the styles the role needs (body: 400, 400 italic, 700; heading: 700). Pages link the hosted stylesheet and set --font-<role> to the family followed by the theme fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `headingFont` and `bodyFont` are SITE settings (optional text, empty means the theme stack) with descriptions and env overrides; a role the active theme does not declare is ignored
- [ ] #2 The Look page has a font section per declared role: a curated list (body: Atkinson Hyperlegible, Source Serif 4, Literata, Merriweather, Lora, Source Sans 3, IBM Plex Serif, IBM Plex Sans, plus the theme default; heading adds Fraunces and Playfair Display), a Custom option with a text field for any Google family, and a sample line set in the saved font
- [ ] #3 Saving downloads the family first; a refusal (unknown family, missing style, no network) shows the reason beside the field and writes nothing
- [ ] #4 Every HTML page with a chosen font links the hosted @font-face stylesheet as a fingerprinted same-origin asset and prints `--font-<role>: "<family>", <fallback>`; with no font chosen the page loads nothing extra
- [ ] #5 When a chosen font files are missing at render time the page falls back to the stack and a refetch job is queued once
- [ ] #6 The admin CSP needs no third-party font host for the sample (the sample uses the hosted files)
- [ ] #7 Tests cover settings, the save path with a stubbed font store, the page head with and without fonts, and the missing-files fallback; docs/settings.md and the Appearance docs describe the font choice and the required styles
<!-- AC:END -->
