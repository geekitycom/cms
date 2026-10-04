---
id: TASK-265
title: >-
  The daisyui/ folder, the GEEKITY_ADMIN switch, and the admin stylesheet
  compiled with Tailwind and DaisyUI
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
updated_date: '2026-10-04 11:21'
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
First step of decision-30. The new admin is built under packages/cms/daisyui/ (layouts/, components/, pages/, static/, and src/ for the stylesheet) beside the untouched packages/cms/admin/. With GEEKITY_ADMIN=daisyui set, that folder goes ahead of admin/ in the template loader and the static-asset roots, both of which already take a list, so a file there wins and anything not yet converted falls through to the old admin; unset, the old admin is served exactly as today. The stylesheet is a build product the way the default theme's is (decision-22): daisyui/src/admin.css, compiled by pnpm build to daisyui/static/admin.css, importing Tailwind in full (Preflight on from day one; no legacy rules are carried) with DaisyUI 5 loaded, every built-in theme enabled, and a light and a dark theme named as the defaults that follow the system. The five test files that read admin templates from disk take the same switch. The DaisyUI MCP server's setup and config guidance (daisyui_setup_expert with install and config) says how the plugin block is written. Until the flip in TASK-275, a path a later task gives under admin/ means its counterpart under daisyui/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GEEKITY_ADMIN=daisyui puts packages/cms/daisyui/ ahead of packages/cms/admin/ for templates and for /admin/_static/ files, with fallthrough to admin/ for anything missing; unset, every admin screen and asset is served exactly as before and the whole existing suite passes
- [ ] #2 daisyui/src/admin.css is the source; pnpm build (and the package pretest) writes daisyui/static/admin.css, gitignored like editor.js; the file imports tailwindcss in full and the DaisyUI plugin with every built-in theme, a light theme as the default and a dark one for prefers-color-scheme: dark; daisyui is a devDependency and daisyui is in the package files entry
- [ ] #3 A daisyui/layouts/base.njk links the compiled stylesheet, and with the switch on the login screen renders from it (checked over HTTP) while an unconverted screen still renders from admin/ under it
- [ ] #4 Tailwind scans daisyui/ and editor/main.ts, so a DaisyUI class written in either reaches the compiled file
- [ ] #5 The tests that read admin templates by path (styles, keyboard, fields, routes, assets) resolve the directory through the same switch, and the README and package README describe the switch, the source file and the build step
<!-- AC:END -->
