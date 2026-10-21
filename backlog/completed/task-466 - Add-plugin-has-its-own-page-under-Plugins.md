---
id: TASK-466
title: Add plugin has its own page under Plugins
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 13:24'
updated_date: '2026-10-21 13:40'
labels:
  - admin
  - plugins
dependencies: []
priority: medium
ordinal: 400800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Plugins screen (/admin/plugins, packages/cms/admin/pages/plugins/installed.njk) draws the Add plugin form as a card below the installed list. Move it to its own page, reached by an Add plugin button on the Plugins screen, the same way other admin lists link to a separate form for a new item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /admin/plugins lists the installed plugins and has an Add plugin button linking to a new page, with no install form on the list
- [x] #2 The new page holds the package, version and password fields with the trust warning, posts to the same install handler, and shows its errors on the new page
- [x] #3 After a successful install the user lands where they do today, and the admin navigation marks Plugins as current on the new page
- [x] #4 Tests and docs/admin.md (and docs/plugins.md where it says where to install from the admin) describe the new page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in plugins-install.test.ts: list has an Add plugin link and no install form; GET /admin/plugins/add draws package, version, password and the trust warning, posts to the same path, marks Plugins in the nav, links back; refused and failed installs redraw that page with what was typed; off refuses GET.
2. plugins.ts: GET PLUGINS_ADD_PATH draws new pages/plugins/add.njk (refuses when the installer is not on); POST redraws add page on password, spec and install errors; success keeps manage()'s redirect.
3. installed.njk: header with Add plugin buttonLink (installer on), Updates card stays; drop the form.
4. docs/admin.md routes row, docs/plugins.md Installing from the admin, plugin-umami README wording.
5. Full verify + screenshots at 1280 and 390.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GET /admin/plugins/add (pages/plugins/add.njk) holds the form; the Plugins header has an Add plugin button when the installer is on, and the list keeps only the Updates card. POST /admin/plugins/add redraws the add page (400) with what was typed on a wrong password, a bad package spec, or an install that throws (for example an integrity mismatch), which used to flash on the list; success keeps manage()'s redirect to /admin/plugins (or ?reloaded=1 under serve). GET add refuses with the installer's reason when installing is off. The nav marks Plugins > Installed plugins on the new page, like the confirm screen; no Add new menu child, since the menu is static and the installer can be off. Verified: pnpm build, test, test:11ty, typecheck, lint, format:check all pass; curl + headless Chrome screenshots of the list, the add page and a refused add at 1280 and 390 (headless Chrome lays out at 500 minimum, users/new crops the same way; a 500 capture shows the form fits).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Add plugin moved from a card on /admin/plugins to its own page at /admin/plugins/add, reached by an Add plugin button in the Plugins header and linking back to Plugins. The page posts to the same handler; refused and failed installs redraw it with the package, version and error, and a successful install lands on the Plugins screen as before. Tests in plugins-install.test.ts cover the button, the page, the nav state, the redraws, the success redirect and the off state; docs/admin.md and docs/plugins.md describe the page. Verified with the full build/test/typecheck/lint/format run and screenshots.
<!-- SECTION:FINAL_SUMMARY:END -->
