---
id: TASK-465
title: >-
  Admin asset URLs change with each release so browsers load fresh CSS and JS
  after an upgrade
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 12:44'
updated_date: '2026-10-21 12:55'
labels:
  - admin
  - bug
dependencies: []
priority: high
ordinal: 400800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin serves /admin/_static/admin.css and its scripts with cache-control public, max-age=3600 at the same URL in every version. After the 0.37.0 upgrade on andrewshell.org, the browser kept the 0.36.1 admin.css, which has no chart classes, so every dashboard chart drew in solid black until a shift-reload. Every admin static asset URL should carry the CMS version (for example ?v=0.37.0) so an upgrade loads fresh files while the hour-long cache still applies between releases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every admin page links admin.css and each admin script under /admin/_static/ with a query that names the running CMS version
- [x] #2 The versioned URLs are served with the same cache headers as today, and the unversioned URLs still work
- [x] #3 Assets referenced from other admin assets or plugin screens, if any, are versioned the same way or noted as not needing it
- [x] #4 Tests assert the versioned links on an admin page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add an adminAsset(name) global to the admin Nunjucks environment (templates.ts) that returns /admin/_static/<name>?v=<CMS version>, the version read once from ownManifest() at module load.
2. Replace every {{ assetPrefix }}name in admin templates (base layout, admin bar, editor, media, tools, federation, users, settings) with {{ adminAsset('name') }}, and drop assetPrefix from the render contexts in routes.ts, admin-bar.ts and server-error.ts so no template can link an unversioned file.
3. The /admin/_static/* route reads only the pathname, so ?v= is ignored and headers stay max-age=3600 with an ETag; unversioned URLs keep working.
4. Tests first: assets.test.ts asserts every /admin/_static/ URL on the login page, dashboard, editor, media library and a public page's admin bar carries ?v=<version>, and that the versioned URL gets the same cache-control and ETag as the plain one; admin-folder.test.ts fails on any template that writes _static/ or assetPrefix instead of adminAsset(). Update existing tests that matched unversioned links.
5. Note in implementation notes that no admin asset references another by URL (no ES imports in the static JS, admin.css has only data: URLs) and plugins link no admin assets.
6. Document the versioned URLs in docs/admin.md.
7. Verify with the full pnpm chain and curl against a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. adminAssetUrl(name) in packages/cms/src/admin/templates.ts returns /admin/_static/<name>?v=<version>, the version read once from ownManifest() at module load; it is the adminAsset() global on the admin Nunjucks environment. Every {{ assetPrefix }}name in admin templates became {{ adminAsset('name') }} and assetPrefix was removed from the render contexts in routes.ts, admin-bar.ts (public admin bar) and server-error.ts, so a template that tries the old form renders an empty prefix and admin-folder.test.ts fails on any template that writes _static/ or assetPrefix.
AC#3: no admin asset references another by URL. The static JS files have no import statements or dynamic import(); editor.js is one bundle. admin.css and admin-bar.css hold only data: URLs, and admin-bar.css is inlined into the bar's shadow root rather than linked. No plugin package links anything under /admin/_static/.
The /admin/_static/* route reads only the pathname, so the query is ignored: the versioned URL gets the same Cache-Control public, max-age=3600 and ETag, and the plain URL still works.
Verified: pnpm build && pnpm test (cms 6522 pass, 0 fail) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Scratch site from geekity init on port 3465: /admin/login links admin.css?v=0.37.0; signed in, /admin/posts/new?kind=note links admin.css, admin-bar.js, editor.js, slug.js, upload-drop.js, location.js all ?v=0.37.0; /admin/media links copy, upload-drop, media, job-status ?v=0.37.0; the public home page's admin bar links admin-bar.js?v=0.37.0. curl -I on admin.css?v=0.37.0 and admin.css both give 200, cache-control public, max-age=3600, the same etag. Docs: docs/admin.md /admin/_static/* row.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admin static asset URLs now carry the running CMS version (/admin/_static/admin.css?v=0.37.0), so an upgrade makes browsers fetch the new stylesheet and scripts while the hour-long cache still applies between releases. One helper, adminAssetUrl / the adminAsset() Nunjucks global in packages/cms/src/admin/templates.ts, builds every link; assetPrefix is gone from the template contexts, and admin-folder.test.ts fails on any template that links a static file another way. assets.test.ts checks every /admin/_static/ link on the login page, dashboard, editor, media library and export tool carries ?v=<version> and that the versioned URL serves the same headers and ETag as the plain one. Verified with the full pnpm build/test/test:11ty/typecheck/lint/format:check chain and curl against a scratch site (login, editor, media, public admin bar, and headers on the versioned URL).
<!-- SECTION:FINAL_SUMMARY:END -->
