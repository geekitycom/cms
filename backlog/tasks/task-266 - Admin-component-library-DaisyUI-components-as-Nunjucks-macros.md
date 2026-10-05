---
id: TASK-266
title: 'Admin component library: DaisyUI components as Nunjucks macros'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 00:52'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-265
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 225800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: every DaisyUI component the admin uses is written once, as a Nunjucks macro under admin/components/, the way fields.njk already writes form fields. A screen composes macros and never spells out component markup of its own. Each macro emits the canonical DaisyUI markup (take it from the MCP server's daisyui_component_syntax_expert, one call per component), takes modifiers such as colour, size and style as arguments, and takes a body through {% call %} where the component has one. Colours are only DaisyUI's semantic tokens so every built-in theme renders the admin unmodified. This task builds the library and the two tests that keep it honest; the screens adopt it in later tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Macros exist for button (and a link drawn as one), alert, card, stat, badge, table (wrapped for horizontal scroll), tabs, pagination, menu, navbar and dropdown, each emitting the DaisyUI markup the syntax expert returns and documented at the top of its file
- [x] #2 A macro with a body (card, alert, table) takes it through {% call %}; modifiers are arguments that map to DaisyUI modifier classes, never free-form class strings pasted by the caller
- [x] #3 A test reads every admin template and fails on any non-semantic colour: a hex value, an arbitrary colour utility, or a Tailwind palette colour such as gray-200
- [x] #4 A test reads every admin template and the compiled stylesheet and fails on a class token that has no rule in the compiled output, so a misspelled DaisyUI class cannot land; it replaces the admin-* check in styles.test.ts
- [x] #5 doc-5 gains a section naming the library, its macros and the two rules (semantic colours only, every class has a rule)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape. One file per component under daisyui/components/: button.njk (button, buttonLink), alert.njk, card.njk (card, cardActions), stat.njk (stats, stat), badge.njk, table.njk, tabs.njk, pagination.njk, menu.njk, navbar.njk (navbar, navbarStart, navbarCenter, navbarEnd), dropdown.njk. Each closed set of modifiers (colour, style, size, shape, direction, placement) is a top-level {% set %} map from argument value to the full DaisyUI class, so Tailwind sees every class written out. Booleans (active, zebra, pin) are {% if %} around a literal class. Body through {% call %} for card, cardActions, alert, table, stats, navbar and its parts, dropdown. List-shaped components (tabs, menu, pagination) take the data the routes already hand screens ({label, url, current}, the menu registry's {label, url, open, children}, and previousUrl/nextUrl/page/pages).
2. A `modifier` filter on the admin Nunjucks environment looks an argument up in its map: nothing for none or '', the class for a known value, and a render error naming the allowed values for anything else, so a misspelt modifier fails loudly instead of drawing an unstyled component. No macro takes a class argument.
3. createAdminTemplateEnvironment takes an optional list of roots, so the macro tests render daisyui/ over admin/ in the default suite without a child process.
4. Tests first (src/admin/components.test.ts): render each macro and compare to the canonical markup from daisyui_component_syntax_expert; unknown modifiers throw; a class argument is ignored.
5. styles.test.ts: replace the admin-* check with two sweeps over every .njk under daisyui/ (found by reading the folder, so a new template joins without a list): (a) no hex, arbitrary colour utility or Tailwind palette/black/white colour; (b) every class token, from class attributes, literal interpolations and modifier maps, is written out in full and has a rule in the compiled daisyui/static/admin.css. Fixture cases prove each check refuses a real defect. The At a glance tests stay until the stat component replaces the counts.
6. Dropdown: the admin CSP refuses style attributes, so the canonical anchor-name/position-anchor inline styles cannot ship; rely on the popover invoker as implicit anchor and verify placement in headless Chrome.
7. doc-5: add a section naming the library, its macros, and the two rules, through backlog doc update.
8. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; the new tests again with GEEKITY_ADMIN=daisyui; quality inspector over the new files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the library as eleven files under packages/cms/daisyui/components/, one per component: button.njk (button, buttonLink), alert.njk, card.njk (card, cardActions), stat.njk (stats, stat), badge.njk, table.njk, tabs.njk, pagination.njk, menu.njk, navbar.njk (navbar, navbarStart, navbarCenter, navbarEnd), dropdown.njk. Canonical markup came from daisyui_component_syntax_expert, one call per component (workflow m30-admin-components). Defaults follow the reference: btn-sm, badge-sm, table-sm.

Modifiers. Each closed set is a top-level {% set %} map from name to full DaisyUI class, so Tailwind reads every class written out. A new `modifier` filter on the admin environment (src/admin/templates.ts) looks the argument up: '' when absent, ' <class>' when known, and a render error naming the allowed values otherwise. No macro takes a class argument. createAdminTemplateEnvironment gained a `roots` option so tests render daisyui/ over admin/ in the default suite.

Deliberate departures from the reference, each documented in its file:
- dropdown: no inline anchor-name/position-anchor styles, because the admin CSP (style-src 'self' 'nonce-…') refuses style attributes. The popover's invoker is its implicit anchor. Verified in headless Chrome 154 over CDP: the `end` placement aligned right edges (button right 382, popover right 382, popover top = button bottom 232); the default aligned left edges (600/600, top 464 = button bottom). Safari and Firefox were not checked; DaisyUI's @supports fallback centres the popover where position-area is missing.
- tabs: a labelled <nav> of links with aria-current, not role=tablist/tab, because these navigate and have no panels or arrow keys. DaisyUI styles .tab and [aria-current=page] either way.
- buttonLink: no role="button", because the link navigates.
- table: a required caption rendered sr-only, so the TASK-143 caption sweep in keyboard.test.ts holds for it under the switch.

Tests. src/admin/components.test.ts renders every macro and compares it to the exact expected markup; every macro refuses an unknown modifier and ignores a class= argument. styles.test.ts: the admin-* check (and its comment-status check) is replaced by two sweeps over every .njk under daisyui/ against daisyui/static/admin.css, read from the folder independent of GEEKITY_ADMIN: (a) every class token from class attributes, literal interpolations and modifier maps is written out in full and has a rule in the compiled sheet; (b) no hex, arbitrary colour utility, colour function, or Tailwind palette/black/white colour. Fixture cases in the same file prove each check fires. A mutation run on the real files (btn-primay in button's map, bg-gray-200 on card) failed both sweeps for those tokens and passed again once restored. The At a glance tests stay; they go with the dashboard's stat conversion.

Validation: pnpm build, pnpm test (4154 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass from the repo root. With GEEKITY_ADMIN=daisyui, components.test.ts (42) and the sweeps (26) pass, and keyboard.test.ts's caption check passes for components/table.njk. daisyui_quality_inspector passes over the eleven files after the conditional classes were separated from their closing tags with `{%- endif %}`; its first run had misread `btn-active{%` as one token. Rendered QA was not run: no screen uses the macros yet. deslop and no-comments were run; comment-sicko trimmed 31 comment blocks and removed 13, leaving each file's header doc.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the DaisyUI admin's component library: eleven Nunjucks macro files under daisyui/components/ (button and buttonLink, alert, card, stats, badge, table, tabs, pagination, menu, navbar, dropdown). Each emits the syntax expert's markup and takes its modifiers as closed sets that map to DaisyUI classes through a new `modifier` filter, which fails the render on an unknown value. The admin-* check in styles.test.ts is replaced by two sweeps over every daisyui/ template: every class is written out and has a rule in the compiled sheet, and no colour is outside the semantic tokens. doc-5 gains a Components section. Verified by components.test.ts (exact markup per macro), fixtures and a mutation run for both sweeps, a headless-Chrome check of dropdown placement without inline anchor styles, the quality inspector, and pnpm build, test (4154 pass), typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
