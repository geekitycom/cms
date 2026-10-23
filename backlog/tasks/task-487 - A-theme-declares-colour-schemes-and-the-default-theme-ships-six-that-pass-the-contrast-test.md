---
id: TASK-487
title: >-
  A theme declares colour schemes, and the default theme ships six that pass the
  contrast test
status: To Do
assignee: []
created_date: '2026-10-23 02:12'
labels:
  - theme
  - appearance
  - accessibility
milestone: m-46
dependencies: []
references:
  - packages/cms/themes/default/src/style.css
  - packages/cms/themes/default/theme.json
  - packages/cms/src/web/theme-colors.test.ts
  - backlog/docs/doc-9
ordinal: 412800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: a theme lists its colour schemes in theme.json and its stylesheet carries the tokens for each, so a site can choose one without writing a theme. The packaged theme keeps Paper as its first scheme with its current values and adds five more, each with a light and a dark set, and the contrast test checks all of them, so a scheme that fails cannot ship.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 theme.json accepts `schemes`, a list of `{ name, label }`; `themeColor` can be given per scheme; the manifest loader validates both and a theme without `schemes` loads as before
- [ ] #2 The packaged theme declares paper (first, current values unchanged), slate, forest, plum, ocean and ink (a monochrome high-contrast scheme), each with light and dark `--color-*` tokens
- [ ] #3 The compiled stylesheet applies a scheme under `:root[data-scheme="<name>"]`; its dark set applies under `prefers-color-scheme: dark` unless `data-mode="light"`, and always under `data-mode="dark"`; a page with no `data-scheme` looks as it does today
- [ ] #4 theme-colors.test.ts checks every declared scheme in both modes at the existing minimums (text 7:1, relied-on borders and focus 3:1, code tokens on the code background), and fails if a declared scheme has no tokens in the stylesheet
- [ ] #5 The forced-colours rules still apply under every scheme
- [ ] #6 docs/theme/page-shell.md Colours and docs/theme/manifest.md describe schemes, the selectors and what a site theme replacing static/style.css must supply
<!-- AC:END -->
