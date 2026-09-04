---
id: TASK-29
title: 'Settings: site.json is the source of truth; drop the settings table'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 16:02'
labels:
  - admin
milestone: m-4
dependencies:
  - TASK-14
  - TASK-28
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-1 - Architecture-Overview.md
type: task
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Invert TASK-14. Today SQLite holds the settings and `content/_data/site.json` is a mirror written on save; decision-9 makes the file the only source. The settings screen reads the file, validates the form, and writes the file back atomically (write to a temporary name, rename); the existing `_data` watcher already reloads it for the theme. `seedSiteSettings`, the settings table and its migration go away. Introduce the shared atomic-write helper here, since this is the first file the admin owns outright; later tasks reuse it. Keep `effectiveBaseUrl` semantics: a base URL from config or the environment still wins over the file at boot. A site whose database has settings rows but whose file is missing or older must have the rows written out to the file once on first boot, then the table dropped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Saving the settings screen rewrites content/_data/site.json atomically and the public site, the feeds and the ActivityPub actor reflect the change without a restart
- [x] #2 Editing site.json by hand while the server runs is reflected on the site and in the settings screen on the next request
- [x] #3 The settings table no longer exists; an existing database with settings rows is migrated into site.json on first boot and the migration is proved by a test
- [x] #4 A base URL from config or GEEKITY_BASE_URL still overrides the file's url at boot, and the settings screen still shows it read-only
- [x] #5 Concurrent saves cannot interleave: writes to one file are serialised in process and a torn file is never observable
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all through the public surface: the new src/files/atomic.ts (bytes land, parent created, mode honoured, no temp file left behind, two writers to one path serialised and never a torn read); app.request against a real CMS for the settings screen (GET reads the file, POST rewrites it and the public site, both feeds and the actor document change without a restart, a hand edit of site.json shows on / and on the screen, a base URL from config or GEEKITY_BASE_URL still wins and the field is read-only); and a boot over a database built in the old shape (a settings table with rows and no site.json, or one older than the rows) proving the file is written once and the table is gone.

2. src/files/atomic.ts, exported from src/files/index.ts and the package barrel: writeFileAtomically(file, contents, { mode? }) — mkdir -p the parent, write a temporary sibling, rename over the target; updateFileAtomically(file, produce, { mode? }) — the same, with the current contents (or undefined) handed to produce, so a read-modify-write of one file cannot interleave with another; and writeFileAtomicallySync for the boot migration, which runs inside the synchronous createCms. A per-path promise queue serialises every one of them in process (decision-9), and the map entry is dropped when the queue drains. TASK-30's key files take { mode: 0o600 }; TASK-32's JSONL appends are updateFileAtomically with a produce that appends a line.

3. Settings become a view of the file, not of SQLite. settingsFromSiteJson(data) is the tolerant reader (what seedSiteSettings used to do inline) and siteJsonFor(settings, existing) stays the writer, so the two are inverses; siteJsonFor gains actorHandle and actorType, which the file has to carry now that nothing else does. readSiteSettings(contentDir) replaces readSiteSettings(store) — every caller already has the config in hand, so notify.ts, federation/{article,delivery,federation,relays}.ts and admin/{documents,federation,preview,taxonomy,settings}.ts change one argument each. writeSiteJson becomes atomic through the helper and updateSiteSettings(contentDir, change) does the re-read-then-write inside the file's queue, which is what a save and a taxonomy rename both go through.

4. The theme reads the file alone. createSiteDataSource already re-reads site.json when its stat key moves, so the SiteSettingsSource overlay on the renderer goes away with the table it was covering for; that is what makes a hand edit show on the next request.

5. seedSiteSettings goes; migrateSettingsToFile({ admin, contentDir }) replaces it, run once in createCms before the base URL is settled. It reads the legacy rows through two new narrow AdminStore accessors (legacySettings(), dropLegacyTable(name)), writes them into site.json when the file is missing or older than the newest row — keeping the actor handle and type from the rows either way, since the file never carried them — and drops the table. countSettings/allSettings/setSettings and their prepared statements go, because a prepared SELECT over a dropped table would fail at open. Migration 3 stays as it shipped.

6. effectiveBaseUrl is unchanged; the settings screen shows the base URL in effect in the field so a file with no url still renders something valid, and the field stays read-only when config or GEEKITY_BASE_URL names one.

7. Tests: files/atomic.test.ts is new; settings.test.ts loses the seeding tests and gains the file-source, hand-edit, migration and concurrent-save ones; every harness that seeded settings through an admin store (federation, delivery, inbox, relays, article, notify, feeds, site, posts tests and scripts/fed-smoke.ts) writes site.json instead. Demo site.json gains actorHandle and actorType.

8. README.md and packages/cms/README.md stop calling site.json a mirror; doc-1 and doc-4 only if they still name SQLite as the settings source. Then pnpm build, test, typecheck, lint, format:check from the root, and a manual pass on port 3000 over a scratch content and data dir: save the form, read /, /feed/ and the actor JSON, hand-edit site.json and reload.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

New `packages/cms/src/files/atomic.ts` (barrel `src/files/index.ts`, re-exported from the package): `writeFileAtomically(file, contents, { mode? })`, `updateFileAtomically(file, produce, { mode? })`, `writeFileAtomicallySync` and `readFileIfPresentSync`. Every write goes to a temporary sibling and is renamed over the target, and a per-path promise queue serialises them in process; `updateFileAtomically` puts the read inside the queue, which is the primitive a read-modify-write of one file needs. `src/images/variants.ts` dropped its private `writeAtomically` for the shared one.

`content/_data/site.json` is now the only source of settings. `settingsFromSiteJson(data)` reads the file tolerantly (what `seedSiteSettings` used to do inline) and `siteJsonFor(settings, existing)` writes it, so the two are inverses; `siteJsonFor` gained `actorHandle` and `actorType`, which the file has to carry now that nothing else does. `readSiteSettings(contentDir)` replaced `readSiteSettings(store)` — every caller already had the config in hand, so `notify.ts`, `federation/{article,delivery,federation,relays}.ts` and `admin/{documents,federation,preview,taxonomy,settings}.ts` changed one argument each. `updateSiteSettings({ contentDir, change })` is the write path both the settings screen and the taxonomy screens use; `writeSiteJson` is it with a constant change.

`seedSiteSettings`, `writeSiteSettings`, `storeSiteSettings`, `settingsSiteData` and the `SiteSettingsSource` overlay on the renderer are gone, along with `AdminStore.countSettings/allSettings/setSettings`. `createSiteDataSource` reads the file alone, which is what makes a hand edit reach the theme. `AdminStore` gained `legacySettings()` and `dropLegacyTable(name)`, and `migrateSettingsToFile({ admin, contentDir })` runs once in `createCms` before the base URL is settled.

## Decisions

- **A file read per call, not a settings store.** `readSiteSettings` reads and parses `site.json` on every call rather than caching it. The file is a few hundred bytes, the read is microseconds beside a Nunjucks render, and it is what makes AC #2 unconditional: nothing anywhere can be holding a stale copy. The theme keeps the `stat`-keyed cache it already had in `createSiteDataSource`, whose key is mtime, size and inode, so a rename is noticed immediately.
- **The queue lives in the write helper, not in a settings object.** decision-9 asks for writers to one file to be serialised in process; a per-path queue in `atomic.ts` serves `site.json`, and will serve `users.json`, `followers.json` and the inbox log without any of them owning a lock. `updateFileAtomically` covers the read as well as the write, so two saves cannot each read the old file first — the manual pass fired six concurrent saves and the one that lost still kept the key the winner had not touched.
- **A synchronous variant for boot.** `createCms` is synchronous and settles `config.baseUrl` from the settings before it returns, so the migration cannot await. `writeFileAtomicallySync` is the same temp-and-rename for that one caller, documented as such; it runs before the server is listening and before anything else has written a file.
- **Migration 3 stays as it shipped.** A shipped migration is never edited, so a fresh database still creates the `settings` table — and `migrateSettingsToFile` drops it a moment later, whether or not it had rows. The drop cannot be a migration of its own: migrations run when the database is opened, which is before anything knows where the content directory is, and dropping the rows before they are written out is the one mistake this milestone cannot make. The prepared statements over the table had to go with it, because a `SELECT` over a missing table throws when it is prepared.
- **Which side wins the migration.** The file wins when its mtime is newer than the newest settings row — a hand edit, or a content directory restored from git — and the rows win otherwise. Either way the actor handle and type come from the rows, because `site.json` never carried them and an actor whose handle changed is one every follower has to find again.
- **The base URL field shows the one in effect.** `effectiveBaseUrl` is unchanged, but the form now renders the effective URL rather than the file's `url`, so a `site.json` with no `url` at all does not present an empty field the validator would refuse.
- **`notifyServerOf` defaults when the key is absent.** The overlay used to supply the default; without it a site.json with no `notifyServer` would have advertised no hub while the CMS pinged one. Missing is now the default and empty is still off, which is the rule the settings read the file by.
- **Tests seed the file, not a store.** Every harness that opened an `AdminStore` to write settings before boot now writes `site.json` (federation, delivery, inbox, relays, article, notify, feeds, site, posts, `scripts/fed-smoke.ts`).

## Mutation checks

Each mutation failed exactly the tests that name that behaviour:

- `enqueue` running its task at once instead of queueing -> only 'runs the read and the write as one step, so concurrent updates cannot lose one' failed. (The torn-read test still passed, correctly: the rename alone is what makes a write atomic.)
- `migrateSettingsToFile` a no-op -> both migration tests failed, nothing else.
- `siteJsonFor` without `actorHandle`/`actorType` -> the actor save test, the site.json shape test, both migration tests and two federation tests failed.
- `readSiteSettings` memoised per content directory -> 19 tests failed, the hand-edit and restart ones among them.

## Validation

`pnpm build`, `pnpm test` (938 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test:11ty` (10 + 5) all pass from the repo root, plus `pnpm fed:smoke`.

## Manual pass on port 3000

A scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in), `apps/demo/server.ts`, signed in as a user created with `geekity user add`.

- **AC #1.** Saved the form with a new title, tagline, author, page size, actor handle `writer` and actor type `Organization`. `site.json` was rewritten with every key including `actorHandle` and `actorType` and kept `feedSize: 20`; `/` showed the new title, `/feed/` the title and the tagline as its description, `/feed/atom/` the title, and `/ap/actor` came back `Organization` with the new name, summary, `preferredUsername` and the avatar as its `icon`. WebFinger resolved `acct:writer@localhost:3000`. No restart.
- **AC #2.** Hand-edited `site.json` with the server running — title, tagline, `actorHandle`, `postsPerPage: 1`. The next requests showed the edit on `/`, in `/feed/`, on the settings form (title, handle and page size), in the actor document, in WebFinger for the new handle, and the home page dropped to one article with `/page/2/` answering 200.
- **AC #3.** Recreated the old `settings` table in the scratch database with sixteen rows (including a menu, a relay, a `taxonomyRedirects` line and an empty `notifyServer`), moved `site.json` away and booted: the file was written with all of it, `sqlite_master` no longer had the table, `/` served the migrated title, `/ap/actor` was the migrated `Service` actor with handle `fromrows`, `/tag/eleventy/` answered 301 to `/tag/11ty/` from the migrated redirect, and the emptied notify server took `<cloud>` out of the RSS feed. The database this version had created a moment earlier already had no `settings` table, which is the drop on a fresh database.
- **AC #4.** With `baseUrl` in the demo's config the field rendered `readonly disabled` with 'The config file sets baseUrl…' and `<code>http://localhost:3000</code>` as the value in effect.
- **AC #5.** Six concurrent `POST /admin/settings` (all 303) against 200 reads of the file in a loop: no read failed to parse, the file held one whole save, and `taxonomyRedirects` — a key the form does not carry — survived, which is the re-read inside the write.

Port 3000 was released and the scratch directories deleted; `git status apps/demo` shows only the two keys added to the committed `site.json`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Inverted TASK-14: `content/_data/site.json` is the source of truth for a site's settings and the settings table is gone.

The settings screen reads that file, validates the form and writes it back through a new shared helper, `packages/cms/src/files/atomic.ts` — `writeFileAtomically`, `updateFileAtomically` and a synchronous variant for boot, each a temporary sibling renamed over the target behind a per-path promise queue. `updateFileAtomically` puts the read inside the queue, so a save re-reads the file it is about to replace and two saves at once cannot each keep half of what the other kept; the same helper now writes the image variants and is what TASK-30 to TASK-34 will write keys, users, followers and the inbox log with. `settingsFromSiteJson` and `siteJsonFor` are the file's reader and writer and are inverses of each other, the file now carries `actorHandle` and `actorType` because nothing else does, and `readSiteSettings(contentDir)` reads it per call rather than caching, so a hand edit is on the public site, in the feeds, on the settings screen and in the ActivityPub actor on the very next request. The renderer's settings overlay went with the table it was covering for. A database with settings rows has them written into the file once on the first boot — the file winning when it was edited after the rows, but never over the actor handle and type — and `migrateSettingsToFile` then drops the table; migration 3 stays exactly as it shipped. `effectiveBaseUrl` is unchanged and the field is still read-only when the config or `GEEKITY_BASE_URL` names one.

Verified with 938 package tests (0 fail), 8 of them new over the write helper and 5 over the file as the source, the migration and concurrent saves, each mutation-checked: unqueueing the writes, skipping the migration, dropping the actor keys from the file and memoising the settings read each failed exactly the tests that name that behaviour. Then a manual pass on a real server on port 3000 over a scratch content and data directory covering all five criteria — a save reaching `/`, both feeds, the actor and WebFinger without a restart; a hand edit of `site.json` reaching all of them and the settings screen on the next request; a database rebuilt in the old shape migrating into the file, dropping the table and serving its migrated title, actor, archive redirect and emptied notify server; the read-only base URL field; and six concurrent saves that no reader ever caught mid-write. `pnpm build`, `test`, `typecheck`, `lint`, `format:check`, `test:11ty` and `fed:smoke` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
