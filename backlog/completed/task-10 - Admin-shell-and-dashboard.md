---
id: TASK-10
title: Admin shell and dashboard
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 02:49'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-9
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin layout in Nunjucks loosely following WordPress classic: left navigation (Dashboard, Posts, Pages, Settings, Users, Federation), top bar with site name and View Site link, flash messages. Dashboard shows counts of published posts, drafts, and pages, the five most recent posts, and a quick draft form.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /admin renders the layout with navigation to every section listed in doc-5
- [x] #2 Dashboard counts match the index
- [x] #3 Quick draft creates a draft post file and redirects to its editor
- [x] #4 Flash messages survive one redirect and then clear
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the Hono HTTP surface through `app.request` (nav, dashboard counts, quick draft, flash, the admin stylesheet route, the section placeholders), the exported flash helpers, and a new content save helper. Tests are colocated node:test files under packages/cms/src/.
2. src/content/save.ts: `contentFilePath({type, slug, date})` (posts/{yyyy}-{mm}-{dd}-{slug}.md, pages/{slug}.md), `freeSlug()` for a slug nothing on disk or in the index already claims, and `saveDocument({contentDir, store, path, content})` which serialises, writes atomically (temp file in the same directory + rename), parses the bytes back and upserts the index directly, returning the Document. This is doc-1's admin write path and TASK-11 reuses it.
3. Flash on the session, server-side: admin migration 2 adds a `flash` column to `sessions`; the store gains `pushFlash(id, entry)` and `takeFlash(id)` (read and clear in one statement). src/admin/flash.ts wraps them as `flash(c, kind, message)` and `takeFlash(c)`, both no-ops without a session.
4. Static admin CSS: generalise src/web/assets.ts into `findAsset(relative, roots)` / `assetResponse` / `assetNotModified` with a configurable max-age, keep the theme wrappers, and add src/admin/assets.ts serving packages/cms/admin/static/ at /admin/_static/ with a one-hour cache header and ETag. The route is registered before the guard so the login page can load its stylesheet while logged out.
5. Templates: base.njk becomes the shell (top bar with site name and View Site, left nav with the six sections and the current one marked, flash area, signed-in username and a logout form) and falls back to the narrow card when no user is in the context, so login and setup keep working. dashboard.njk gets counts, the five most recent posts and the quick draft form; placeholder.njk answers the sections TASK-11 and later build.
6. Routes: one `render()` that injects site, user, section, flash and the CSRF token; GET placeholders for /admin/posts, /admin/posts/:slug, /admin/pages, /admin/pages/:slug, /admin/settings, /admin/users and /admin/federation; POST /admin/quick-draft writing a draft post and redirecting to /admin/posts/{slug} with a flash.
7. Add a `date` filter to the admin Nunjucks environment, reusing formatDate from src/web/templates.ts.
8. Export the new names from src/admin/index.ts, src/content/index.ts and src/index.ts.
9. Verify: pnpm test/typecheck/lint in packages/cms, the root test/typecheck/lint/format:check, then a manual curl pass against apps/demo covering login, /admin, a quick draft and the file it writes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **The shell is template inheritance, not a conditional.** `layouts/base.njk` is the bare page (head, stylesheet, one centred column) and `layouts/shell.njk` extends it, overriding a `chrome` block with the top bar and a `main` block that wraps the same `content` block in the navigation column. Screens behind the login extend the shell; login and setup extend the base and so have no navigation. One `content` block, no duplicated block names.

- **Navigation is one exported list.** `ADMIN_SECTIONS` in `src/admin/routes.ts` holds the six sections doc-5 names; every screen renders the same list and marks itself with a `section` string. The five that no task has built yet are registered as placeholder handlers (plus `/admin/posts/:slug` and `/admin/pages/:slug`), so no navigation link 404s and the guard covers them from the start. TASK-11 replaces the posts handlers and changes nothing else.

- **The stylesheet is a file, served before the guard.** `packages/cms/admin/static/admin.css` at `/admin/_static/`, one hour of cache plus an ETag. The route is registered ahead of the guard middleware so the login page can load it while logged out; nothing under the prefix is secret. `src/web/assets.ts` grew generic `findAsset`/`assetResponse`/`assetNotModified` (with a `maxAge` option) that the theme helpers now delegate to, so there is one asset implementation rather than two.

- **Flash lives on the session row.** Admin migration 2 adds a `flash TEXT` column holding a JSON array; `pushFlash`/`takeFlash` on the store, wrapped as `flash(c, kind, message)` and `takeFlash(c)` in `src/admin/flash.ts`. Nothing to sign, nothing to forge, no cookie-size limit, and it goes when the session does. `render()` reads it once per page, which is what makes a message survive exactly one redirect. A column that will not parse is treated as empty rather than throwing.

- **The admin write path is `src/content/save.ts`, and TASK-11 reuses it.** `saveDocument()` serialises, parses the bytes back (so a document that cannot be read is refused before it lands), writes a temp file in the destination directory and renames it, then upserts the index directly — doc-1's model, so the response does not wait for the watcher. `contentFilePath()` names the file (`posts/{yyyy}-{mm}-{dd}-{slug}.md`, `pages/{slug}.md`) and `freeSlug()` numbers a slug that either the directory or the index already claims, checking both because they can disagree for a moment.

- **Test harness.** `src/admin/__testing__/harness.ts` holds the sandbox, the cookie-keeping browser and the setup/login flows; `routes.test.ts` now uses it too instead of its own copy. `src/**/__testing__/**` was added to the `tsconfig.build.json` exclude so it does not ship.

- **The `date` filter** was added to the admin Nunjucks environment, reusing `formatDate` from `src/web/templates.ts`, so a date reads the same in the admin as on the public site. No `url` filter: admin paths are absolute and are not subject to the site's base path.

## Validation

- `pnpm test` in `packages/cms`: 377 tests, 76 suites, 0 failures (318 before; 30 new tests in `src/content/save.test.ts`, `src/admin/assets.test.ts`, `src/admin/dashboard.test.ts` and `src/admin/store.test.ts`).
- `pnpm typecheck` and `pnpm lint` in `packages/cms`: clean. Root `pnpm test` (377 + 10), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: all clean.

Manual pass against `apps/demo` on port 3000 (`pnpm dev`), with curl and a cookie jar. The demo had no users, so the first admin was created through `/admin/setup` (`ada`); that account is still in `apps/demo/data/geekity.db`.

- `GET /admin` with no users: 302 to `/admin/setup`; the form links `/admin/_static/admin.css` and carries a CSRF token. `POST /admin/setup`: 303 to `/admin`.
- `GET /admin`: 200, navigation links to all six sections with `aria-current="page"` on Dashboard, top bar reading `Geekity Demo`, a View site link, `Signed in as ada` and a logout form.
- Counts on the page (5 published posts, 1 draft, 3 pages) matched the same three queries run against `data/geekity.db` directly.
- `GET /admin/_static/admin.css`: 200, `text/css; charset=utf-8`, `cache-control: public, max-age=3600`, ETag.
- `POST /admin/quick-draft`: 303 to `/admin/posts/a-note-from-the-manual-pass`; `content/posts/2026-09-03-a-note-from-the-manual-pass.md` appeared with `draft: true`, an explicit permalink and the submitted body; the drafts count went 1 to 2 and the public URL stayed 404.
- The editor page showed `Draft saved: A note from the manual pass` in an `admin-flash` paragraph; the very next request for the same URL had no flash at all.
- `GET /admin/settings`: 200, Settings marked current, "This screen is not built yet." `GET /admin/login` while logged out: no navigation.
- `POST /admin/logout`: 303 to `/admin/login`, and `/admin` then 302s to the login form.

The post file was deleted afterwards (the watcher dropped it from the index; the URL 404s again) and port 3000 was released.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the admin shell and the dashboard behind it.

`admin/layouts/base.njk` is now the bare page and a new `shell.njk` extends it with the WordPress-classic chrome: a top bar carrying the site name, a View site link, who is signed in and a logout form, the six sections doc-5 lists down the left with the current one marked, and a place for flash messages. Login and setup extend the base directly, so they keep the layout and lose the navigation. The five sections no task has built yet answer with a placeholder screen rather than a 404, so the navigation is the shape of the whole admin from the start.

The stylesheet moved out of the layout into `admin/static/admin.css`, served at `/admin/_static/` with an hour of cache and an ETag by a route registered ahead of the guard so the login page can load it. `src/web/assets.ts` gained generic `findAsset`/`assetResponse`/`assetNotModified` that both the theme and the admin now use.

The dashboard shows published posts, drafts and pages from `ContentStore.counts()`, the five most recent posts with date, status and a link to their editor, and a quick draft box that writes a draft post file and redirects to `/admin/posts/{slug}`. That write goes through a new `src/content/save.ts` — `contentFilePath`, `freeSlug` and `saveDocument`, which serialises, writes atomically through a temp file and rename, and upserts the index directly per doc-1, so the response does not wait for the watcher. TASK-11 reuses all three.

Flash messages are a new `flash TEXT` column on `sessions` (admin migration 2) read and cleared as a page renders, exposed as `flash(c, kind, message)` and `takeFlash(c)` and exported for later screens.

Verified with 30 new node:test tests — the shell's navigation and marking, counts against a seeded content directory, the quick draft's file and front matter, slug collisions, and a flash surviving one redirect and then clearing — and a manual curl pass against the running demo covering every acceptance criterion: navigation to all six sections, counts cross-checked against SQLite, a quick draft whose file carried `draft: true` and whose redirect landed on the editor with the flash, and that flash gone on the next request. `pnpm test` (377 pass), `typecheck` and `lint` in the package, and the root `test`, `typecheck`, `lint` and `format:check` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
