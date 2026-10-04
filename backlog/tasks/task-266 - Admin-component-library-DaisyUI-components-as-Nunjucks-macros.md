---
id: TASK-266
title: 'Admin component library: DaisyUI components as Nunjucks macros'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
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
- [ ] #1 Macros exist for button (and a link drawn as one), alert, card, stat, badge, table (wrapped for horizontal scroll), tabs, pagination, menu, navbar and dropdown, each emitting the DaisyUI markup the syntax expert returns and documented at the top of its file
- [ ] #2 A macro with a body (card, alert, table) takes it through {% call %}; modifiers are arguments that map to DaisyUI modifier classes, never free-form class strings pasted by the caller
- [ ] #3 A test reads every admin template and fails on any non-semantic colour: a hex value, an arbitrary colour utility, or a Tailwind palette colour such as gray-200
- [ ] #4 A test reads every admin template and the compiled stylesheet and fails on a class token that has no rule in the compiled output, so a misspelled DaisyUI class cannot land; it replaces the admin-* check in styles.test.ts
- [ ] #5 doc-5 gains a section naming the library, its macros and the two rules (semantic colours only, every class has a rule)
<!-- AC:END -->
