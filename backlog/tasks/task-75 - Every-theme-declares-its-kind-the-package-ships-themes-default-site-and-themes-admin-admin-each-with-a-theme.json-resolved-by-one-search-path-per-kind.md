---
id: TASK-75
title: >-
  Themes have a manifest: themes/default carries a theme.json, a reader
  validates one, and one resolver builds the site search path
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 12:48'
updated_date: '2026-09-13 15:24'
labels:
  - web
milestone: m-13
dependencies: []
references:
  - packages/cms/src/web/templates.ts
  - packages/cms/src/web/assets.ts
  - packages/cms/src/mail/templates.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/admin/templates.ts
  - packages/cms/src/admin/assets.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
type: task
ordinal: 100800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The package ships one unnamed theme at themes/default. Three places build the same two-element search path from PACKAGED_THEME_DIR (the template environment, the /theme/ asset finder and the mail environment) and a fourth probes it per render for the optional front-page and posts-page layouts. This task gives a theme a manifest and puts the resolution in one place, without changing what a site sees: themeDir still works exactly as before and no config or setting changes yet. themes/default gains a theme.json (name, kind, optional description); kind is site and is the only kind there is, kept in the file so a later kind can slot in without a format change. A manifest module reads and validates a theme directory and is what later tasks list and choose by. The admin tree at admin/ is untouched: it stays its own structure with its own loader and is not overridable, as decision-4 says. This is the internal half of decision-15; the config break and the setting come in the next task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 themes/default/theme.json exists with name, kind site and a description, and a manifest reader validates a theme directory: a missing or unparseable theme.json, or a kind other than site, is reported as not a theme with the reason
- [x] #2 One resolver builds the site theme search path and is used by the template environment, the /theme/ asset finder, the mail environment and the front-page and posts-page probe; there is no other literal path to the packaged theme
- [x] #3 The admin tree, its loader and its asset finder are unchanged and still outside the site theme search path; the existing admin asset tests pass untouched
- [x] #4 themeDir, GEEKITY_THEME_DIR and the site theme/ override behave exactly as before; every existing theme override test passes unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/themes/default/theme.json: name 'Default', kind 'site', a description. It ships already because package.json's files list carries themes/.
2. New module packages/cms/src/web/themes.ts, the one place that knows where a theme is: PACKAGED_THEME_DIR moves here from templates.ts (the only literal path left in the tree), themeSearchPath(siteThemeDir) moves here from assets.ts, a new findThemeFile(dirs, relative) answers the per-render probe and the mail present check, and readTheme(dir) reads and validates one theme directory into a Theme (id from the directory name, name, kind, optional description) or a reason it is not a theme (no theme.json, unparseable, missing or empty name, kind other than site).
3. Rewire the four callers to the resolver: web/templates.ts createTemplateEnvironment, web/assets.ts themeSearchPath re-home, mail/templates.ts searchPath and present, web/render.ts themeTemplate. web/index.ts exports PACKAGED_THEME_DIR and themeSearchPath from themes.ts so the public surface is unchanged, plus the new manifest names.
4. Leave admin/ alone: src/admin/templates.ts PACKAGED_ADMIN_DIR and src/admin/assets.ts ADMIN_STATIC_DIR keep their own literals, since the admin is not a theme (decision-4) and the task says so.
5. Tests first, one per criterion: src/web/themes.test.ts for the manifest reader (the packaged theme reads as a site theme; missing, unparseable, nameless and wrong-kind directories each report a reason) and for the resolver (search path is site then packaged, findThemeFile prefers the site's file, the admin directory is not on it). The existing theme override tests in web/site.test.ts, render.test.ts, front-page.test.ts, mail/templates.test.ts and admin/assets.test.ts stay untouched and must pass.
6. Verify with pnpm build, test, typecheck, lint and format:check, and curl a running demo for /theme/style.css and an overridden template.
7. Update packages/cms/themes/default/README.md to mention the manifest. themeDir, GEEKITY_THEME_DIR and the config stay exactly as they are; TASK-76 changes them.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the internal half of decision-15.

New module packages/cms/src/web/themes.ts is the only place that knows where a theme is. It holds PACKAGED_THEME_DIR (moved from web/templates.ts, now the single literal path to the packaged theme in the whole tree — `grep -rn 'themes/default' --include='*.ts'` returns that one line), themeSearchPath (moved from web/assets.ts, same signature and order), a new findThemeFile(dirs, relative) that answers the two questions asked outside a render, and readTheme(dir), the manifest reader.

readTheme returns a discriminated union rather than throwing: { ok: true, theme } or { ok: false, reason }. Every caller a later task will have — the admin's list, a chosen theme that has gone missing, a stray .DS_Store in a site's themes/ — wants a reason, not an exception. A Theme is { id (the directory name), dir, name, kind, description? }. A directory is refused with a sentence when it has no theme.json, when the JSON does not parse, when it is not an object, when it has no name, or when its kind is anything but 'site'.

findThemeFile refuses a relative path that climbs out of a theme directory, resolved-then-checked the way findAsset already does, so the probe cannot be pointed at the file system around a theme.

Rewiring, no behaviour change: createTemplateEnvironment builds its FileSystemLoader from themeSearchPath; web/assets.ts findThemeAsset keeps taking the path and web/routes.ts imports themeSearchPath from themes.ts; mail/templates.ts drops its own two-element array and its existsSync probe for themeSearchPath + findThemeFile; web/render.ts themeTemplate is one findThemeFile call and the file no longer imports node:fs or node:path. web/index.ts and src/index.ts export PACKAGED_THEME_DIR and themeSearchPath from themes.ts instead of templates.ts/assets.ts, so the public surface is unchanged, plus the new names (readTheme, findThemeFile, THEME_MANIFEST_FILE, SITE_THEME_KIND, Theme, ThemeKind, ThemeRead).

packages/cms/themes/default/theme.json declares name Default, kind site and a description. It ships already: package.json's files list carries themes/.

The admin is untouched. src/admin/templates.ts keeps PACKAGED_ADMIN_DIR and src/admin/assets.ts keeps ADMIN_STATIC_DIR, each its own literal, because the admin is not a theme (decision-4) and must stay off the site search path. A test in themes.test.ts asserts the admin directory is never on it.

themeDir, GEEKITY_THEME_DIR and src/config.ts are exactly as they were; the config break and the theme setting are TASK-76.

Verification.

pnpm build, pnpm test (1630 pass in @geekity/cms, 15 in demo, 0 fail), pnpm test:11ty (16 + 5 pass), pnpm typecheck, pnpm lint and pnpm format:check all pass. The 17 new tests are in packages/cms/src/web/themes.test.ts and were written failing first (the run before themes.ts existed was ERR_MODULE_NOT_FOUND).

HTTP, against the demo run with its own theme/ on port 3411:
- GET /theme/style.css served the demo's stylesheet, 200 with cache-control, etag and last-modified as before.
- GET /2026/08/markdown-on-disk/ rendered through the demo's theme/layouts/post.njk (post-byline and '1 minute read'), while /nope/ still 404s through the packaged 404 layout.
- GET /admin/_static/admin.css 200 text/css, so the admin's own asset finder is unaffected.
- GET /theme/theme.json and /theme/nope.css both 404: the manifest is not reachable over HTTP, because /theme/ serves static/ and nothing else.

Then restarted on port 3412 with GEEKITY_THEME_DIR pointing at a scratch theme: /theme/style.css served the scratch stylesheet, and the post came back without the demo's byline, so the environment variable still replaces the configured theme directory and the packaged theme still fills in file by file. Both servers stopped; git status shows no stray demo state.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
themes/default now carries a theme.json (name Default, kind site, a description) and a new module, packages/cms/src/web/themes.ts, is the one place that knows where a theme is: PACKAGED_THEME_DIR, themeSearchPath, findThemeFile and readTheme, the manifest reader that returns either a Theme or the reason a directory is not one (no theme.json, unparseable, not an object, no name, or a kind other than site). The template environment, the /theme/ asset finder, the mail environment and the front-page and posts-page probe all resolve through that one search path, and the only literal path to the packaged theme left in the tree is the one inside this module. The admin keeps its own loader, its own asset finder and its own literals and stays off the path, as decision-4 says. Nothing a site sees changed: themeDir, GEEKITY_THEME_DIR and the theme/ override behave exactly as before, and the config break and the theme setting are TASK-76. Verified with 17 new tests in src/web/themes.test.ts written failing first, the full suites green unchanged (1630 + 15 unit, 16 + 5 Eleventy), build, typecheck, lint and format:check, and curls against the running demo on two ports: the site theme's stylesheet and post layout, the packaged 404, the admin's /admin/_static/admin.css, a 404 for /theme/theme.json, and GEEKITY_THEME_DIR swapping the theme at boot.
<!-- SECTION:FINAL_SUMMARY:END -->
