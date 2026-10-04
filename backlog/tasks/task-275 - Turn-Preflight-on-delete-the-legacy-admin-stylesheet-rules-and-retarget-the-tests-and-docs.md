---
id: TASK-275
title: >-
  Turn Preflight on, delete the legacy admin stylesheet rules and retarget the
  tests and docs
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-271
  - TASK-272
  - TASK-273
  - TASK-274
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: chore
ordinal: 234800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30, last step. With every screen converted, the admin stylesheet source imports Tailwind in full (Preflight on), the legacy rules are deleted, and only the listed authored exceptions remain: the bar's stylesheet, the CodeMirror surface, and any custom property DaisyUI's syntax requires. The tests that read the old stylesheet as text are retargeted or removed, doc-5 is rewritten to describe the DaisyUI admin (the shell, the component library, the theme choice, the bar), and the READMEs follow. Finish with a screenshot pass of every screen in a light and a dark theme at phone and desktop widths, and the deslop and no-comments passes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 admin/src/admin.css imports tailwindcss in full; no legacy admin-* rule remains, and the only authored selectors are the CodeMirror surface rules and what DaisyUI syntax requires
- [ ] #2 styles.test.ts, keyboard.test.ts and fields.test.ts read the compiled stylesheet or the rendered pages, not the deleted rules; the whole suite, typecheck, lint and format check pass
- [ ] #3 doc-5 describes the DaisyUI admin: the shell, the component library and its two rules, the per-user theme, the shadow-rooted bar on both sides; the README and package README no longer promise a plain-CSS admin
- [ ] #4 Every admin screen was screenshotted in one light and one dark built-in theme at 390 and 1280 wide with no horizontal overflow, clipped text or unstyled element, and the screenshots are attached to the task or linked from it
<!-- AC:END -->
