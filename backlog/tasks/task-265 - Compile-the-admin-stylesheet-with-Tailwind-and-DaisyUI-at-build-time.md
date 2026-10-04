---
id: TASK-265
title: Compile the admin stylesheet with Tailwind and DaisyUI at build time
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies: []
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: chore
ordinal: 224800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First step of decision-30. The admin stylesheet becomes a build product the way the default theme's is (decision-22): a source under admin/src/ compiled by pnpm build to admin/static/admin.css, with DaisyUI 5 loaded and every built-in theme enabled, a light and a dark theme named as the defaults that follow the system. Preflight stays off and the legacy admin.css rules are kept in the source so every screen keeps rendering as it does today; later tasks convert the screens and the last one turns Preflight on. The DaisyUI MCP server's setup and config guidance (daisyui_setup_expert with install and config) says how the plugin block is written.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 admin/src/admin.css is the source; pnpm build (and the package pretest) writes admin/static/admin.css, which is gitignored like editor.js and still served at /admin/_static/admin.css with the same caching
- [ ] #2 daisyui is a devDependency; the compiled file contains every built-in DaisyUI theme and names a light theme as the default and a dark one for prefers-color-scheme: dark
- [ ] #3 Preflight is not imported; every admin screen renders exactly as before the change (the legacy rules are in the compiled output), and the whole test suite passes
- [ ] #4 Tailwind scans the admin templates and editor/main.ts, so a DaisyUI class written in either reaches the compiled file
- [ ] #5 The README and the package README name the source file and the build step where they describe the admin stylesheet
<!-- AC:END -->
