---
id: TASK-487
title: >-
  A theme declares colour schemes, and the default theme ships six that pass the
  contrast test
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:12'
updated_date: '2026-10-23 02:48'
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
- [x] #1 theme.json accepts `schemes`, a list of `{ name, label }`; `themeColor` can be given per scheme; the manifest loader validates both and a theme without `schemes` loads as before
- [x] #2 The packaged theme declares paper (first, current values unchanged), slate, forest, plum, ocean and ink (a monochrome high-contrast scheme), each with light and dark `--color-*` tokens
- [x] #3 The compiled stylesheet applies a scheme under `:root[data-scheme="<name>"]`; its dark set applies under `prefers-color-scheme: dark` unless `data-mode="light"`, and always under `data-mode="dark"`; a page with no `data-scheme` looks as it does today
- [x] #4 theme-colors.test.ts checks every declared scheme in both modes at the existing minimums (text 7:1, relied-on borders and focus 3:1, code tokens on the code background), and fails if a declared scheme has no tokens in the stylesheet
- [x] #5 The forced-colours rules still apply under every scheme
- [x] #6 docs/theme/page-shell.md Colours and docs/theme/manifest.md describe schemes, the selectors and what a site theme replacing static/style.css must supply
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. themes.ts: parse theme.json schemes ({ name, label, themeColor }) tolerantly like areas; per-scheme themeColor falls back to the top-level one; Theme.schemes and ChosenTheme.schemes (a site theme with no schemes inherits the packaged ones only while it ships no static/style.css); export themeScheme(schemes, name) that returns the named scheme or the first.
2. style.css: redefine Tailwind's dark variant as prefers-color-scheme: dark unless data-mode=light, plus data-mode=dark; Paper stays on :root and also :root[data-scheme=paper] with its dark set in @variant dark; add slate, forest, plum, ocean, ink blocks the same way; color-scheme follows data-mode.
3. theme.json: schemes list with per-scheme themeColor equal to each scheme's --color-body.
4. theme-colors.test.ts: read compiled CSS, emulate the cascade on <html> (selectors, specificity, order, prefers-color-scheme) for every declared scheme x mode; run PAIRS on each; check a plain page equals Paper, data-mode overrides the system, every declared scheme has its own tokens, themeColor matches --color-body, and color-scheme follows the mode.
5. theme-stylesheet.test.ts: forced-colours rules name no scheme or mode and nothing sets forced-color-adjust.
6. Tune the five new palettes with a scratch generator (OKLCH, lightness walked until each pair passes with margin); confirm in headless Chrome.
7. Docs: page-shell.md Colours, manifest.md, themes.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Manifest: schemes are { name, label, themeColor }; name must match /^[a-z][a-z0-9-]*$/; bad entries and repeats are dropped (tolerant like areas); a scheme's themeColor falls back to the top-level one. Theme.schemes and ChosenTheme.schemes; a site theme with no schemes inherits the packaged ones only while it ships no static/style.css. Accessor themeScheme(schemes, name) returns the named scheme or the first (undefined only when there are none).
Stylesheet: Tailwind's dark variant is redefined as @media (prefers-color-scheme: dark) &:not([data-mode=light]) plus &[data-mode=dark]; each scheme is one block with its dark set inside @variant dark. Paper stays on :root (and :root[data-scheme=paper]) with unchanged values; color-scheme follows data-mode.
Test: theme-colors.test.ts emulates the cascade on <html> from the compiled CSS (selectors, specificity, order, prefers-color-scheme) for every scheme in theme.json and both modes; runs all PAIRS; checks plain page = Paper, data-mode beats the system, each declared scheme has its own [data-scheme] tokens, themeColor = --color-body, color-scheme follows mode. Mutation check: renaming ocean's selector and weakening slate muted both failed it.
Palettes tuned with a scratch OKLCH generator; Ink holds text to 10:1 and borders to 4.5:1. lightningcss rewrites #c0c0c0 to silver, which the test cannot read, so Ink uses #c2c2c2.
Headless Chrome confirmed computed --color-body/--color-primary/color-scheme for all 7 x 3 attribute combinations under light and dark system settings, plus screenshots of four schemes.
Validation: pnpm build, pnpm test (cms 7035 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The theme manifest accepts schemes with per-scheme themeColor (themes.ts, themeScheme accessor). The packaged theme declares paper (unchanged), slate, forest, plum, ocean and ink, and its stylesheet draws each under :root[data-scheme] with a dark set that follows prefers-color-scheme unless data-mode=light and always applies under data-mode=dark. theme-colors.test.ts now checks every declared scheme in both modes against the compiled CSS. Forced-colours rules are checked to be scheme-independent. Docs updated (page-shell.md Colours, manifest.md, themes.md). Verified with the full build/test/typecheck/lint/format run and headless Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
