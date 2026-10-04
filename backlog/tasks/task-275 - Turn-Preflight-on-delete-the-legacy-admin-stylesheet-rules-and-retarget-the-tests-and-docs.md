---
id: TASK-275
title: >-
  Flip to the DaisyUI admin: prove daisyui/ complete, rename it to admin/,
  remove the switch, retarget the tests and docs
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
updated_date: '2026-10-04 11:21'
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
decision-30, last step. A test proves the daisyui/ folder stands alone: every template the admin asks for by name (ADMIN_TEMPLATES), and everything those templates extend, import or include, resolves inside daisyui/ with no fallthrough, and every static file the templates reference is there (editor.js and the other scripts move with it). With that green, delete packages/cms/admin/, rename daisyui/ to admin/, remove the GEEKITY_ADMIN switch and its mentions, and point the loader, the asset roots, the build scripts, the gitignore and the package files entry at the one folder. The tests that read the old stylesheet as text are retargeted or removed, doc-5 is rewritten to describe the DaisyUI admin (the shell, the component library, the theme choice, the bar), and the READMEs follow. Finish with a screenshot pass of every screen in a light and a dark theme at phone and desktop widths, and the deslop and no-comments passes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A completeness test resolves every ADMIN_TEMPLATES entry and everything it extends, imports or includes, and every referenced static file, inside the new folder alone, and it passes before the rename
- [ ] #2 packages/cms/admin/ is the renamed daisyui/ folder, the old admin is deleted, GEEKITY_ADMIN is gone from the code, the tests, the READMEs and the Docker files, and the package files entry names admin only
- [ ] #3 No legacy admin-* rule remains anywhere; the only authored selectors are the bar stylesheet, the CodeMirror surface rules and what DaisyUI syntax requires; the whole suite, typecheck, lint and format check pass
- [ ] #4 doc-5 describes the DaisyUI admin: the shell, the component library and its two rules, the per-user theme, the shadow-rooted bar on both sides; the README and package README no longer promise a plain-CSS admin or mention the switch
- [ ] #5 Every admin screen was screenshotted in one light and one dark built-in theme at 390 and 1280 wide with no horizontal overflow, clipped text or unstyled element, and the screenshots are attached to the task or linked from it
<!-- AC:END -->
