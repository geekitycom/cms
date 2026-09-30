---
id: TASK-145
title: >-
  Default theme CSS: forced colours, touch targets, text wrapping and logical
  properties
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 04:29'
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
- [x] #1 Under forced-colors: active, focus rings, buttons and borders stay visible
- [x] #2 Interactive controls meet the 24x24 CSS px minimum target size
- [x] #3 Headings use text-wrap: balance and body copy text-wrap: pretty
- [x] #4 Directional margins, padding and borders use logical properties, and a page with dir=rtl mirrors correctly
- [x] #5 The default theme sets scrollbar-gutter: stable
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a throwaway Playwright audit (system Chrome, scratchpad, not committed) over the demo content plus a kitchen-sink post with open comments, and both refused forms: it measures every control not inline in a sentence against 24x24, checks under dir=rtl that every box's left and right margin, padding and border swap and nothing scrolls sideways, reads text-wrap-style and scrollbar-gutter off the computed style, and under emulated forced-colors checks that buttons, fields, rules, code blocks and the error summary keep an edge and every Tab stop draws an outline. Run it on the current stylesheet as the baseline.
2. Write packages/cms/src/web/theme-stylesheet.test.ts first, failing: a small parser over style.css asserts no physical inline-axis property or asymmetric four-value shorthand anywhere, scrollbar-gutter: stable on html, text-wrap balance on h1-h6 and pretty on p and li, a 24px minimum on the standalone links, buttons and checkbox, and a forced-colors block that borders buttons, rules and code blocks and draws focus in a system colour.
3. Change packages/cms/themes/default/static/style.css to pass it: logical properties throughout (lists, blockquote, hlist, diff lines, skip link, bio avatar, categories, nested comments, honeypot, narrow-screen query), text-wrap, scrollbar-gutter, min target sizes, and the forced-colors block. Keep .screen-reader-text as it is.
4. Rerun the audit to zero failures, then pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proof came from a throwaway Playwright audit (system Chrome, scratchpad, not committed). It serves the demo content on the default theme, adds a kitchen-sink post with open comments and a nested reply, and submits both the comment and contact forms refused so the role=alert summary is on the page. Pages: /, the kitchen-sink post, /search?q=markdown, /contact/, /archive/, /posts/, plus the two refused forms, at 390px wide. Checks: every control not inline in a sentence is at least 24x24 (a checkbox is injected where the form has none); under dir=rtl every element's computed left and right margin, padding and border swap and the page does not scroll sideways; text-wrap-style is balance on h1-h6 and pretty on main p and e-content li; scrollbar-gutter on html is stable; under emulated forced-colors: active, buttons, fields, hr, pre and the error summary keep a border in a colour other than Canvas, and every Tab stop draws an outline in a colour other than Canvas. The HEAD stylesheet fails 202 checks (94 mirror, 76 target, 14 forced, 6 each balance, pretty, gutter). The new stylesheet fails 0. RTL and forced-colours screenshots were checked by eye.
Decisions: focus needed no forced-colours rule, because every ring is an outline and the forced palette redraws outlines; the audit confirmed it on every Tab stop. The committed test guards this instead by failing if any :focus rule sets outline to none. Standalone links take display: inline-flex with a 24px min-block-size and min-inline-size, which grows the hit box and keeps the text on its line's baseline. Links inside a sentence (footnote refs, backrefs, links in prose) are left alone under the WCAG 2.5.8 inline exception. The honeypot moved from left: -10000px to inset-inline-start, because under rtl the physical offset made the page scroll sideways.
Validation: pnpm build, pnpm test (2648 + 31 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme's style.css now survives a forced palette, gives touch targets a 24x24 minimum, balances headings and wraps prose prettily, mirrors under dir=rtl, and reserves the scrollbar gutter. Under @media (forced-colors: active), the buttons, the hr and code blocks get a system-colour border. Standalone links (site and footer menus, categories, post nav, pagination, comment permalink and Reply, error-summary links) and the form buttons get a 24px min-block-size and min-inline-size, and the comment/contact checkbox is 24x24. Headings use text-wrap: balance and p/li/dd use text-wrap: pretty. html sets scrollbar-gutter: stable. Every left/right margin, padding, border and inset, including the narrow-screen query and the honeypot, is now a logical property. New packages/cms/src/web/theme-stylesheet.test.ts parses the stylesheet: it fails on any physical inline-axis property or asymmetric four-value shorthand, on any :focus rule that removes an outline, and on a missing gutter, text-wrap, target minimum or forced-colours border. Verified with a Playwright audit in system Chrome (202 failures on the old stylesheet, 0 on the new) and with the full build, test, typecheck, lint and format gates.
<!-- SECTION:FINAL_SUMMARY:END -->
