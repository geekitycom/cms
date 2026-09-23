---
id: TASK-14
title: Settings screen with content/_data/site.json mirror
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 03:56'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings table in SQLite and a form at /admin/settings for site title, tagline, base URL, timezone, posts per page, actor handle, and actor type. On save, mirror the public subset to content/_data/site.json so an Eleventy build sees the same values. The theme reads settings for the site header and metadata.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Saving settings updates the site title shown on the public site
- [x] #2 content/_data/site.json is rewritten on save and contains title, tagline, url, and author
- [x] #3 Posts per page setting changes home page pagination
- [x] #4 Base URL is validated as an absolute http(s) URL
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all through `app.request` on the existing admin harness plus the public routes: GET /admin/settings (the form, its values, the base URL note), POST /admin/settings (a good save redirects and flashes; a bad one is a 400 that re-renders with per-field errors and writes nothing), the public GET / (title and pagination after a save), the bytes of content/_data/site.json on disk, and boot seeding (a site whose content/_data/site.json exists comes up with those values in SQLite). New colocated node:test file src/admin/settings.test.ts, plus additions to src/config.test.ts and src/web/render.test.ts.

2. Storage. Admin migration 3 adds a key/value `settings` table (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL). Key/value rather than one row so M3 can add federation keys without a migration per field. AdminStore gains three untyped accessors — countSettings(), allSettings(): Record<string,string> and setSettings(values): void (one transaction, upsert) — and nothing else; the typed shape lives one level up.

3. src/admin/settings.ts holds the meaning: the SiteSettings shape (title, tagline, baseUrl, timezone, postsPerPage, author, actorHandle, actorType), SETTINGS_DEFAULTS, ACTOR_TYPES (doc-4: Person default, Organization, Service, Group, Application), readSiteSettings(store), settingsProblems(form) returning one message per bad field, seedSettings() and the site.json writer.

4. Source of truth and precedence. When the settings table is empty on boot, seed it from content/_data/site.json if that file exists, else from the defaults and the resolved config. After that SQLite is the source: createSiteDataSource takes an optional SiteSettingsSource and overlays the stored values on top of the JSON file, so the theme sees a saved title on the very next request rather than waiting on an mtime. The JSON read stays underneath, both as the fallback for a CMS with no admin store and as the carrier of keys the form does not manage (feedSize and anything a site added). Every save rewrites the public subset — title, tagline, url, author, postsPerPage, timezone — to content/_data/site.json through a temp file and a rename, keeping every unknown key it already had.

5. Base URL. ResolvedConfig gains baseUrlSource ('environment' | 'config' | 'default') so the CMS can tell an explicit deployment value from the http://localhost:<port> fallback. An explicit GEEKITY_BASE_URL or config-file value wins and the settings field is shown read-only with the reason; otherwise the stored value becomes config.baseUrl at boot. It is applied at boot and not on save, deliberately: config.baseUrl also decides whether the session cookie is Secure, and flipping that mid-session over http would log the person saving out of their own admin. The form says so.

6. Validation, before anything is written: title non-empty; base URL an absolute http(s) URL; posts per page a positive integer; timezone a zone Intl accepts (try/catch around new Intl.DateTimeFormat(undefined, { timeZone })); actor handle the same username-like pattern the users table uses; actor type one of ACTOR_TYPES. A bad form is a 400 that re-renders with the submitted values and one message per field, and neither SQLite nor site.json is touched.

7. The screen. admin/layouts/settings.njk on the existing shell, ADMIN_TEMPLATES.settings, 'settings' added to the built set in routes.ts so the placeholder loop skips it, mountSettings(app, { render }) beside mountDocumentScreens, and whatever admin.css needs for the field-level errors.

8. Verify: package test/typecheck/lint, root lint/typecheck/test/test:11ty/format:check, README on the precedence and the settings screen, then a manual curl pass against apps/demo — change the title and read it off /, read the rewritten site.json, set posts per page to 2 and fetch /page/2/, post a bad base URL and read the error — restoring apps/demo to its committed state and releasing port 3000 afterwards.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress

New files: `src/admin/settings.ts` (the whole settings module: the `SiteSettings` shape, defaults, validation, seeding, the site.json mirror and the two routes), `src/admin/settings.test.ts`, `admin/layouts/settings.njk`. Changed: `src/admin/store.ts` (migration 3 and the three key/value accessors), `src/admin/routes.ts` (mountSettings, 'settings' in the built set), `src/admin/templates.ts`, `src/config.ts` (baseUrlSource), `src/web/context.ts` (createSiteDataSource takes a SiteSettingsSource), `src/web/render.ts`, `src/index.ts` (seed on boot, settle config.baseUrl, hand the settings to the renderer), the three barrels, `admin/static/admin.css`, README.

Package `pnpm test` 454 pass (437 before; 17 new — 14 in settings.test.ts, 2 in store.test.ts, 1 in config.test.ts), typecheck and lint clean. Root lint, typecheck, test (454 + 10), test:11ty (6 + 5) and format:check clean.

## Mutation checks

The new tests were mutation-checked rather than trusted. Each of these failed exactly the tests that name that behaviour and nothing else:

- Renderer built without the settings overlay -> only 'makes SQLite the source once the settings are stored, not the file' failed. (AC #1's own test still passed, because the rewritten site.json carries the title too; the overlay is what the source-of-truth test pins.)
- Save without the site.json rewrite -> both site.json tests, the AC #4 'nothing was written' check and the source-of-truth test failed.
- settingsProblems returning {} -> all five validation tests failed.
- seedSiteSettings reading no file -> both seeding tests failed.
- config.baseUrl not settled from the settings at boot -> only the base URL test failed.

## Decisions

- **Key/value, not one row.** Migration 3 is `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`. The store keeps three untyped accessors — `countSettings()`, `allSettings()`, `setSettings()` (one transaction, upsert, keys not named left alone) — and no opinion about what a key means. `src/admin/settings.ts` is where the meaning lives. M3 adds a federation key with a row, not a migration.
- **SQLite is the source; the JSON file is the mirror and the seed.** The first boot that finds the table empty fills it from `content/_data/site.json`, so a site that predates the screen and a fresh `geekity init` both keep what they had. After that the file is no longer read for those keys. Proven by the test that hand-edits the file, moves its mtime a second into the future, and still gets the stored title on the public page.
- **The theme reads the settings on top of the file, not instead of it.** `createSiteDataSource` takes an optional `SiteSettingsSource`; the file stays underneath as the fallback for a renderer built without an admin store and as the carrier of the keys the form does not manage (`feedSize` and anything a site added by hand). That is what makes AC #1 true on the very next request instead of on the next mtime check.
- **The base URL is settled at boot, not on save.** `ResolvedConfig.baseUrlSource` ('environment' | 'config' | 'default') is new. An explicit value wins and the form renders the field disabled with the reason; otherwise the stored value becomes `config.baseUrl` once, in `createCms`, before the renderer is built. Deliberately not on save: `config.baseUrl` also decides whether the session cookie is `Secure`, so applying an https base URL mid-session over http would log the person out of the form they had just submitted. The hint under the field says the change is picked up when the site next starts. A disabled field is not submitted, so the save handler keeps the stored value rather than reading the empty one.
- **The mirror is atomic and round-trips.** Written to `site.json.<pid>.tmp` beside the file and renamed over it, so an Eleventy build or the site data source sees one whole version or the other. It always carries `title`, `tagline`, `url`, `author`, `postsPerPage` and `timezone` — a stable shape a template can reference without guarding — and keeps every other key the file had.
- **Nothing is written until the whole form is valid.** `settingsProblems` returns one message per bad field; a form with any is a 400 that re-renders with what was typed and touches neither SQLite nor the file. Timezone is checked by constructing `Intl.DateTimeFormat` in a try/catch rather than against a list, so it agrees with whatever the runtime actually supports. The actor handle pattern is tighter than a username's — no dots, no @ — because it becomes the local part of `@handle@host`.
- **Actor handle and type are stored but not mirrored.** doc-2 names four keys for `site.json`; the federation settings are not site data an Eleventy build has any use for, so they stay in SQLite for M3 to read.

## Manual pass against apps/demo, over curl

On port 3000 (`pnpm dev`), signed in as `ada`.

- **Seeding.** The first boot with the new migration filled the settings from the demo's own `content/_data/site.json`: the form came back with 'Geekity Demo', its tagline, 'Andrew Shell' and posts per page 2, none of which had ever been typed into it.
- **AC #1.** Saved the title as 'Geekity Demo, Renamed'. `GET /` came back `<title>Geekity Demo, Renamed</title>` on the next request, and `/feed.xml` `<title>Geekity Demo, Renamed</title>` with the tagline as its subtitle. The redirect was a 303 to /admin/settings and the flash read 'Settings saved.'
- **AC #2.** `apps/demo/content/_data/site.json` was rewritten to title, tagline, url, author, postsPerPage and the new timezone, with `"feedSize": 20` — a key the form does not manage — still in it.
- **AC #3.** At 2 per page `/page/2/` was 200 and held 'Markdown on disk' and 'Six tables and a migration'; saved 10 per page and it became a 404; saved 2 again and it was 200 again.
- **AC #4.** With the demo config's `baseUrl` in place the field rendered `disabled` and said 'The config file sets baseUrl…' beside 'In effect: http://localhost:3000'. With it removed the field was editable and `example.com`, `ftp://example.com` and `/relative` each came back 400 with 'The base URL has to be an absolute http:// or https:// URL' under the field — and the title submitted alongside them, 'Should Not Land', reached neither the public site nor site.json.
- **Boot precedence.** Saved `http://127.0.0.1:3000/` with no config baseUrl, restarted, and the feed's `<id>` was `http://127.0.0.1:3000/` — the stored value became the effective one at boot, and the trailing slash was normalised away.

Everything the pass touched was put back: `apps/demo/geekity.config.ts` and `apps/demo/content/_data/site.json` restored from git, the demo's eight settings rows deleted so the next boot reseeds, and a final boot confirmed 'Geekity Demo', `/page/2/` 200 and `git status apps/demo` clean. Port 3000 released.

## Validation

Package `pnpm test` 454 pass, 101 suites, 0 failures (437 before; 17 new — 14 in src/admin/settings.test.ts, 2 in src/admin/store.test.ts, 1 in src/config.test.ts). `pnpm typecheck` (both projects) and `pnpm lint` clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (454 + 10), `pnpm test:11ty` (6 + 5) and `pnpm format:check` all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the admin the screen doc-5 asks for, and settled where a site's own values actually live.

`/admin/settings` edits title, tagline, author, base URL, time zone, posts per page and the ActivityPub actor handle and type. They are stored in a new `settings` table of key and value (admin migration 3) beside the users and sessions — doc-1's data that lives only in SQLite — and the store keeps three untyped accessors over it while `src/admin/settings.ts` holds the shape, the defaults, the validation, the seeding and the mirror.

The precedence is the part that matters. On the first boot that finds the table empty it is seeded from `content/_data/site.json`, so a site that predates the screen and one `geekity init` has just written both keep the values they had. After that SQLite is the source: the theme reads the settings laid over the file rather than the file alone, so a saved title is on the public page and in both feeds on the very next request, and every save rewrites the public subset back to `site.json` through a temp file and a rename so an Eleventy build of the same content renders the same. Keys the form does not manage — `feedSize`, anything a site added — round-trip untouched. The base URL is the exception: `GEEKITY_BASE_URL` or a config-file `baseUrl` wins, because a base URL decides absolute URLs, feed ids and whether the session cookie is `Secure`, and the form renders the field disabled and says which value is in effect and why. When neither names one, the stored value becomes `config.baseUrl` at boot — at boot rather than on save, so an https base URL cannot log out the admin who just submitted it over http. Nothing is written until every field is valid; a bad form is a 400 that re-renders with what was typed and one message under each field, and touches neither SQLite nor the file.

Verified with 17 new node:test tests through `app.request`, every one mutation-checked: removing the settings overlay, the site.json rewrite, the validator, the seed and the boot base URL each failed exactly the tests that name that behaviour. Then a curl pass against the running demo covering all four criteria — the form seeded from the demo's own site.json, a renamed title on `/` and `/feed.xml`, the rewritten site.json still carrying `feedSize`, `/page/2/` appearing at 2 per page and 404ing at 10, and `example.com`, `ftp://example.com` and `/relative` each refused 400 with nothing written — plus a restart proving the stored base URL becomes the effective one. `pnpm test` (454 pass), typecheck and lint in the package, and root `lint`, `typecheck`, `test`, `test:11ty` and `format:check` all pass; the demo was restored to its committed state and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
