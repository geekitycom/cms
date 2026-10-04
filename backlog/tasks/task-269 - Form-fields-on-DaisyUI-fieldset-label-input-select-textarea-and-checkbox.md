---
id: TASK-269
title: 'Form fields on DaisyUI fieldset, label, input, select, textarea and checkbox'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-266
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 228800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the seven macros in admin/components/fields.njk emit DaisyUI markup (fieldset, fieldset-legend, label, input, select, textarea, checkbox, and validator for a refused field), which converts the 160 field sites across the settings pages, the users screens, the account screens and the editor in one step. What the macros promise today stays: a visible label bound by for and id, the error before the hint, aria-invalid and aria-describedby on a refused control, value always written, and the refused-form summary, which becomes an alert. Take the markup from the MCP server's syntax expert for each component.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every macro in fields.njk emits DaisyUI markup for its control, with the label bound by for/id, the error paragraph before the hint, and aria-invalid plus aria-describedby on a refused control, and fields.test.ts passes updated to the new markup
- [ ] #2 The refused-form summary (field.summary) is a DaisyUI alert with role=alert that still takes focus on load and links to each refused field
- [ ] #3 Every settings page, the users screens and the account screens render through the macros with no per-page field CSS; the form-errors, settings and users test files pass
- [ ] #4 The checkbox macro keeps the sentence beside the tick, and a disabled or readonly control keeps its attribute and is visibly so in both a light and a dark theme
<!-- AC:END -->
