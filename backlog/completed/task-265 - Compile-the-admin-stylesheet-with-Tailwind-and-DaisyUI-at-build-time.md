---
id: TASK-265
title: >-
  The daisyui/ folder, the GEEKITY_ADMIN switch, and the admin stylesheet
  compiled with Tailwind and DaisyUI
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 00:31'
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
- [x] #1 GEEKITY_ADMIN=daisyui puts packages/cms/daisyui/ ahead of packages/cms/admin/ for templates and for /admin/_static/ files, with fallthrough to admin/ for anything missing; unset, every admin screen and asset is served exactly as before and the whole existing suite passes
- [x] #2 daisyui/src/admin.css is the source; pnpm build (and the package pretest) writes daisyui/static/admin.css, gitignored like editor.js; the file imports tailwindcss in full and the DaisyUI plugin with every built-in theme, a light theme as the default and a dark one for prefers-color-scheme: dark; daisyui is a devDependency and daisyui is in the package files entry
- [x] #3 A daisyui/layouts/base.njk links the compiled stylesheet, and with the switch on the login screen renders from it (checked over HTTP) while an unconverted screen still renders from admin/ under it
- [x] #4 Tailwind scans daisyui/ and editor/main.ts, so a DaisyUI class written in either reaches the compiled file
- [x] #5 The tests that read admin templates by path (styles, keyboard, fields, routes, assets) resolve the directory through the same switch, and the README and package README describe the switch, the source file and the build step
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add daisyui ^5 as a devDependency of @geekity/cms (done: 5.7.47).
2. Switch: in src/admin/templates.ts add DAISYUI_ADMIN_DIR and adminDirectories(env), a pure parse of GEEKITY_ADMIN (unset or empty: [admin/]; daisyui: [daisyui/, admin/]; anything else throws naming the variable), and ADMIN_DIRS = adminDirectories(process.env). The Nunjucks loader takes ADMIN_DIRS; src/admin/assets.ts derives ADMIN_STATIC_DIRS from it for findAsset. PACKAGED_ADMIN_DIR and ADMIN_STATIC_DIR stay as the old admin's paths (public exports).
3. Stylesheet: daisyui/src/admin.css imports tailwindcss with source(none), @source the daisyui layouts/components/pages and editor/main.ts, @plugin daisyui with every built-in theme listed, light --default and dark --prefersdark. build:admin script compiles it to daisyui/static/admin.css; build, pretest and pretest:coverage run it; gitignored like editor.js; daisyui added to files.
4. daisyui/layouts/base.njk: same blocks as admin/layouts/base.njk (title, chrome, main, content), links only the compiled admin.css.
5. Test-side helper src/admin/__testing__/admin-files.ts (adminFile, adminTemplates) resolving through ADMIN_DIRS; styles, keyboard and fields tests read through it. routes and assets reach the admin over HTTP, so they follow the switch through the app itself.
6. Tests first: src/admin/daisyui.test.ts for the switch parse, the overlay over HTTP (spawned geekity serve with GEEKITY_ADMIN=daisyui: login and dashboard link only the compiled sheet, dashboard keeps admin/ shell, admin.css is the DaisyUI build, editor.js falls through), the compiled sheet (every built-in theme, light default, dark under prefers-color-scheme, Preflight) and what Tailwind scans (a probe tree compiled with the real source).
7. README and package README describe the switch, the source and the build step.
8. Verify: pnpm build, test, typecheck, lint, format:check; curl the demo with GEEKITY_ADMIN=daisyui; git check-ignore; npm pack --dry-run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Switch: src/admin/templates.ts adminDirectories(env) parses GEEKITY_ADMIN (unset/empty -> [admin/]; daisyui -> [daisyui/, admin/]; anything else throws naming the variable, so a misspelt switch fails at boot). ADMIN_DIRS = adminDirectories(process.env), read once at load; the Nunjucks loader takes it, and src/admin/assets.ts derives ADMIN_STATIC_DIRS from it for findAsset (whose roots parameter widened to readonly string[]). PACKAGED_ADMIN_DIR and ADMIN_STATIC_DIR are unchanged public exports naming the old admin.
Stylesheet: daisyui/src/admin.css imports tailwindcss with source(none), @source ../layouts, ../components, ../pages and ../../editor/main.ts (missing directories are fine for the Tailwind CLI), and @plugin daisyui with all 35 built-in themes listed by name, light --default and dark --prefersdark, logs: false. The list is explicit rather than themes: all so the default pair is named in the source; a test compares it with daisyui's own themeOrder, so an upgrade that adds a theme fails the suite. build:admin compiles it with --optimize; build, pretest and pretest:coverage run it. daisyui 5.7.47 is a devDependency; daisyui is in files; the compiled sheet is gitignored next to editor.js and npm pack --dry-run ships daisyui/static/admin.css.
daisyui/layouts/base.njk keeps admin/layouts/base.njk's blocks (title, chrome, main, content) and links only the compiled admin.css, not admin-bar.css; no data-theme on <html>. With the switch on every admin screen, converted or not, is drawn inside it, so unconverted screens render unstyled under Preflight until their task converts them.
Tests: src/admin/daisyui.test.ts covers the parse, the overlay over HTTP (a child process with GEEKITY_ADMIN=daisyui runs src/admin/__testing__/overlay-probe.ts, because the switch is read at module load), the compiled sheet (every theme, light default, dark under prefers-color-scheme equal to [data-theme=dark], Preflight) and what Tailwind reads (a probe tree with the real source and a symlinked node_modules compiled by the CLI). Defects introduced by hand and seen to fail: a theme dropped, corporate as default, night as prefersdark, the editor or components @source removed, source(none) removed, the static roots cut to daisyui/ alone.
src/admin/__testing__/admin-files.ts (adminFile, adminTemplates) resolves through ADMIN_DIRS; styles, keyboard and fields read through it. routes and assets reach the admin through app.request, so they follow the switch through the app itself and needed no change. With GEEKITY_ADMIN=daisyui those five files fail 56 of 181 tests, by reading daisyui/static/admin.css and rendering under daisyui/layouts/base.njk; that is the work TASK-266..274 convert.
Also: README (workspace layout, pnpm build row, a section on the switch), package README (The DaisyUI admin) and the Dockerfile comment listing files.

Validation: pnpm build, pnpm test (4095 pass in packages/cms, 30 in the Eleventy tests), pnpm typecheck, pnpm lint, pnpm format:check all pass. git check-ignore names .gitignore:17 for daisyui/static/admin.css. Demo over HTTP with GEEKITY_ADMIN=daisyui on port 3000 and a scratch data dir: /admin/login and the unconverted /admin dashboard each link only /admin/_static/admin.css with body class min-h-screen bg-base-200 text-base-content (daisyui/layouts/base.njk); the dashboard still carries <div class="admin-shell"> from admin/layouts/shell.njk; /admin/_static/admin.css is byte-identical to daisyui/static/admin.css; /admin/_static/editor.js is byte-identical to admin/static/editor.js. Unset, /admin/login links admin-bar.css and admin.css and admin.css is byte-identical to admin/static/admin.css. GEEKITY_ADMIN=daisyUI stops the server with the error naming the variable.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the daisyui/ folder, the GEEKITY_ADMIN switch and the compiled DaisyUI stylesheet (decision-30). GEEKITY_ADMIN=daisyui puts packages/cms/daisyui/ ahead of packages/cms/admin/ for the template loader and /admin/_static/ (ADMIN_DIRS in src/admin/templates.ts, ADMIN_STATIC_DIRS in src/admin/assets.ts); unset, the old admin is served unchanged; any other value stops the server at boot. daisyui/src/admin.css is Tailwind in full with Preflight and DaisyUI 5 with every built-in theme, light as the default and dark under prefers-color-scheme: dark, compiled by build:admin (run from build, pretest and pretest:coverage) to the gitignored daisyui/static/admin.css, which ships through the new daisyui entry in files. daisyui/layouts/base.njk keeps the old base's blocks and links only that sheet. Tailwind reads daisyui/layouts, components, pages and editor/main.ts. styles, keyboard and fields tests read through src/admin/__testing__/admin-files.ts; routes and assets follow the switch through the app. Both READMEs describe the switch, the source and the build step. Verified with src/admin/daisyui.test.ts (13 tests, each checked against a hand-introduced defect), the whole gate (build, 4095 + 30 tests, typecheck, lint, format:check), and curl against the demo with the switch on and off.
<!-- SECTION:FINAL_SUMMARY:END -->
