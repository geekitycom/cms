---
id: TASK-257
title: >-
  Lead the public admin bar's site title to the home page, with a View admin
  link
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 00:25'
updated_date: '2026-10-04 01:20'
labels:
  - admin
  - web
dependencies: []
priority: low
type: enhancement
ordinal: 272800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin bar (packages/cms/admin/components/admin-bar.njk, shared by the admin and the public site, TASK-126 and TASK-183) always links the site title to the admin dashboard (adminUrl). In the admin that is right, and its first shortcut is View site. On the public site the title should lead to the home page (/), and the first shortcut should be View admin leading to the dashboard, mirroring the admin's View site. The template takes where the title leads from its caller rather than branching on where it is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a public page the bar's site title links to / and the first shortcut is View admin linking to the dashboard; the other public shortcuts (+ New, Edit post) follow as today
- [x] #2 In the admin the site title still links to the dashboard and View site is unchanged
- [x] #3 Tests pin both bars' links
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests: public bar title -> /, first shortcut View admin -> /admin ahead of + New and Edit Post; admin bar title -> /admin and View site already pinned in src/admin/dashboard.test.ts.
2. admin-bar.njk links the title to siteHref; shell.njk sets siteHref to adminUrl; renderBar passes siteHref '/' and prepends View admin.
3. Verify build/test/typecheck/lint/format through the app's own request path in the tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resumed after a container restart; the earlier agent's edits were correct and kept. Red phase: with the template and renderBar changes reverted, the two public-bar tests in src/web/admin-bar.test.ts failed (title /admin, no View admin); with them applied they pass. The admin bar's links (title /admin, View site /, + New) are pinned by 'keeps View site and gains + New' in src/admin/dashboard.test.ts, which passes unchanged. No golden or ETag fixtures changed: the signed-in public response already drops its validators.
Validation: pnpm build, pnpm test (3964 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The admin bar template now links the site title to siteHref, which each caller sets. The admin shell sets it to the dashboard, so the admin bar is unchanged (title to /admin, then View site, + New). The public bar sets it to / and puts View admin (/admin) first, ahead of + New and Edit Post. Verified by src/web/admin-bar.test.ts, which pins the public bar's order and fails against the old code, by the unchanged admin-bar assertions in src/admin/dashboard.test.ts, and by a clean pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
