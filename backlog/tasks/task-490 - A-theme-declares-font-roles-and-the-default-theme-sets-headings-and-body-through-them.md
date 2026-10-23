---
id: TASK-490
title: >-
  A theme declares font roles, and the default theme sets headings and body
  through them
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:12'
updated_date: '2026-10-23 04:08'
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
- [x] #1 theme.json accepts `fonts`, a map of role to `{ label, fallback }`; the manifest loader validates it and a theme without `fonts` loads as before
- [x] #2 The packaged theme declares heading and body with the current serif stack as both fallbacks; headings (site title, entry titles, prose h2-h4, reply and reaction headings) use `var(--font-heading)` and body text uses `var(--font-body)`; the sans label and mono code stacks are unchanged
- [x] #3 With no font chosen the compiled stylesheet renders exactly as before (the tokens default to the current stacks)
- [x] #4 theme-stylesheet.test.ts checks the role properties exist with their fallbacks and that headings and body read them
- [x] #5 docs/theme/manifest.md and docs/theme/page-shell.md describe font roles and what a site theme replacing static/style.css must supply
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Snapshot baseline: save a set of demo pages' HTML and the current compiled style.css; record computed font-family of every element in headless Chromium.
2. themes.ts: ThemeFont { role, label, fallback, property } parsed tolerantly from a theme.json fonts map (role a lower-case name, fallback a safe font-family list); Theme.fonts; ChosenTheme.fonts with the schemes inheritance rule (site theme without schemes-equivalent fonts and without static/style.css inherits the packaged roles). Tests first in themes.test.ts.
3. Default theme.json declares heading and body with the current serif stack.
4. style.css: :root sets --font-heading and --font-body to the stack (base layer, so a page's unlayered rule overrides); @theme inline aliases font-heading/font-body utilities; body reads --font-body, h1-h6 and the inner-page site title read --font-heading; sans/mono unchanged; headings that are sans labels keep font-sans explicitly. Test first in theme-stylesheet.test.ts, including that the CSS defaults equal the manifest fallbacks.
5. Compare computed font-family before/after on the saved pages in Chromium: no element changes.
6. Docs: docs/theme/manifest.md and docs/theme/page-shell.md.
7. pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
themes.ts: ThemeFont has role, label, property (--font-ROLE) and fallback. The theme.json fonts value is a map of role to label and fallback, parsed tolerantly. The role must match the scheme-name pattern. The fallback must be comma-separated plain or quoted family names, with no semicolon, braces, angle brackets, backslash or open quote, because TASK-492 prints it into a style rule. Theme.fonts and ChosenTheme.fonts (so themes.current().fonts). resolvedSchemes became resolvedFromStylesheet(theme, key), so fonts follow the same inheritance rule as schemes.

style.css: a :root rule in @layer base sets --font-heading and --font-body to the serif stack. @theme inline maps the font-heading and font-body utilities to var(). body and the comment and contact fields use font-body. h1-h6 and .header-link-home use font-heading. --font-serif is removed. .backlinks-title gets font-sans explicitly, because the h1-h6 rule would otherwise override what it inherited from .backlinks.

Rendering check: headless Chromium (playwright-core, chromium-1234) crawled 31 demo pages (2124 elements) before and after the change. The computed font-family of every element was identical. A fixture with every class in style.css found differences only for a bare h1-h6 placed directly inside a sans container (.footnotes, .review, .entry-meta, .kicker and similar). No template puts a heading there, and review HTML has none. A Markdown heading inside a footnote would now be serif instead of sans. Override check: an unlayered :root rule setting both properties changed h1 and body, and left section labels sans and code mono.

The reaction group titles (.reaction-title) are small uppercase sans labels, so they stay sans under decision-61 (labels keep their system stacks). The reply headings (.comments-title, .comment-reply-title) read --font-heading.

Validation: pnpm build, test (cms 7085 pass), test:11ty, typecheck, lint and format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
theme.json gains fonts (a map of role to { label, fallback }). readTheme parses it into Theme.fonts, and chooseTheme(...).fonts resolves it with the same inheritance rule as schemes. The default theme declares heading and body on the serif stack. style.css sets --font-heading and --font-body on :root in @layer base and reads them on body, h1-h6 and the inner-page site title. The sans labels and mono code are unchanged. Tests are in themes.test.ts and theme-stylesheet.test.ts; docs are in manifest.md, page-shell.md and themes.md. Verified with the full pnpm suite and a Chromium before/after comparison of computed fonts on 31 demo pages, which were identical.
<!-- SECTION:FINAL_SUMMARY:END -->
