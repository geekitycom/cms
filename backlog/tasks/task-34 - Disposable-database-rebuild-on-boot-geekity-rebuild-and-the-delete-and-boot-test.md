---
id: TASK-34
title: >-
  Disposable database: rebuild on boot, geekity rebuild, and the delete-and-boot
  test
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:19'
updated_date: '2026-09-04 18:15'
labels:
  - cms
milestone: m-4
dependencies:
  - TASK-29
  - TASK-30
  - TASK-31
  - TASK-32
  - TASK-33
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-1 - Architecture-Overview.md
type: task
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the loop on decision-9. Boot treats a missing database, or one whose cache schema is older than the package can migrate, as an empty cache and rebuilds it from the files: content index, followers and inbox indexes, then everything that only the cache holds (sessions, delivery outcomes) starts empty. Add `geekity rebuild`, which closes the store, deletes the database and rebuilds it the same way, for a person who wants a clean one. Remove any remaining table that is not derived and any leftover seeding or mirroring code. Document the two-directory model in the README (what is in content/, what is in data/, what may be deleted, and what to back up), and note the one capability lost: a post whose file is gone entirely cannot be tombstoned. The acceptance test for the whole milestone is here: boot a federated site with settings, users, keys, followers, inbox entries and published posts, capture the actor document, the followers collection, the outbox, the settings screen and a login; delete the database; boot again; everything captured is identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Booting with no database file rebuilds it from content/ and data/ without a manual step and the site serves identically
- [x] #2 geekity rebuild deletes and rebuilds the database on demand and reports what it indexed
- [x] #3 An integration test boots a fully populated federated site, deletes the database, boots again, and asserts the actor document, followers collection, outbox, settings screen and a login are identical
- [x] #4 No table in the database holds state that cannot be rebuilt from files, other than sessions and delivery outcomes, and the README says so
- [x] #5 The README documents what lives in content/, what lives in data/, what to back up, and that data/geekity.db may be deleted
- [x] #6 The image variant directory from decision-10 is treated as derived state: deleting it together with the database and booting regenerates variants on demand and the site renders
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/cache.ts owns the database file and the migration loop: DATABASE_FILE, databaseFiles(dataDir), discardDatabase(dataDir), applyMigrations(db, {file, ledger, migrations}) and openDatabase({file, ledger, migrations}). Both stores call openDatabase instead of holding their own migrate(); DATABASE_FILE is re-exported from content/store.ts so no export path moves.
2. Three verdicts on an existing database, decided in applyMigrations and recorded here as reasoning. Absent: created and rebuilt, as today. Ledger holds a version this package does not ship (a downgrade): UnusableDatabaseError, boot refuses, naming the file, the version and both fixes (upgrade the package, or geekity rebuild). Refusing rather than rebuilding because a downgrade is usually a mistake and because the alternative is destroying a newer version's cache behind the operator's back. Damaged, so SQLite will not open it or the ledger will not read: the same refusal, for the one reason a rebuild cannot be automatic here — a database from before decision-9 still carries the settings, actor_keys and users rows the boot migrations write out as files, and deleting one because a migration threw would destroy an actor's private keys. Older than the package can migrate (the ledger's newest version is below the oldest migration still shipped): OutdatedDatabaseError, which boot catches, discards the file and reopens, because by definition nothing in it can be carried forward and everything in it is derived.
3. createCms opens the two stores through a helper that closes what it opened, discards the file and retries once on OutdatedDatabaseError, before any of the decision-9 migrations run.
4. geekity rebuild in cli.ts: load the config, refuse when another process holds the database (open it with PRAGMA locking_mode = EXCLUSIVE and BEGIN IMMEDIATE; a live server's WAL readers make that SQLITE_BUSY), delete geekity.db, -wal and -shm, then createCms({watch:false}) + sync(), which runs the same migrations and the same rebuildFederationIndexes boot does. Report the documents indexed and failed, the followers and the inbox activities read back through cms.admin. Non-zero exit when a file would not parse, as sync does. USAGE, cli.test.ts and the package README's command table go with it.
5. Milestone test packages/cms/src/rebuild.test.ts: boot a populated federated site (site.json, a user, key files, followers.json, two inbox months, published posts, an upload with variants) in temp dirs; capture /ap/actor, /ap/actor/followers and its page, /ap/actor/outbox, the settings screen, a post page, a variant response and a successful login; delete geekity.db* and data/images; boot again over the same directories with Sandbox.open; assert every capture is identical, normalising only the session cookie and the CSRF token, and say in the test why those two differ.
6. Leftovers: the Cms.admin doc comment still calls it the half to back up; navigation.ts still says the file and the database cannot disagree; the package README still says geekity user add writes into the database. Audit every table against derived-or-documented-cache and put the result in the README.
7. READMEs: a two-directory section in both — what is in content/ (published, in git), what is in data/ (users.json and keys/, private, backed up), what may be deleted (geekity.db*, images/), what a rebuild loses (sessions, delivery outcomes, the relay handshake so a fresh Follow goes out and a Reject reason is lost, and the schedule watermark, so a post that came due while the process was down and the database was deleted is public but never announced), and the capability decision-9 gives up: a post whose file is gone entirely cannot be tombstoned. doc-1 updated through the CLI.
8. Gates: pnpm build, test, typecheck, lint, format:check, test:11ty, fed:smoke, plus a manual pass on port 3000 over scratch dirs (delete the database and data/images, boot, compare the actor, followers, outbox, a post page and a variant; then run geekity rebuild and read its report).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

New `packages/cms/src/cache.ts` owns the SQLite file as a file: `DATABASE_FILE`, `DATABASE_SUFFIXES`, `databaseFile`, `databaseFiles`, `discardDatabase`, the shared `Migration`/`MigrationLedger` types, `applyMigrations`, `openDatabase` and `withRebuiltDatabase`. Both stores lost their own `migrate()` and their own `new DatabaseSync` and now call `openDatabase({ dataDir, ledger, migrations })`; `DATABASE_FILE` is re-exported from `content/store.ts` so no export path moved. `createCms` opens the two connections through a new `openCache(resolved)`, which closes the content store if the admin store throws so nothing holds the file across a discard.

`geekity rebuild` in `cli.ts`: refuses while something else holds the database, deletes `geekity.db`, `-wal` and `-shm`, then boots — same migrations, same `rebuildFederationIndexes`, same `sync()` — and reports the scan plus the followers and inbox activities read back. `USAGE`, the package README's command table and a new 'Starting the database again' section go with it.

Stale claims from the SQLite-as-source era are gone: `Cms.admin` no longer calls itself the half to back up, `AdminStore`'s own doc comment lists what it holds and where each part comes back from, `Follower` says the file is the source, `config.ts` names `site.json` rather than SQLite for the base URL, `actor.ts` no longer calls the actor type a SQLite row, `navigation.ts` no longer says the file and the database cannot disagree, and the package README no longer says `user add` writes into the database. No seeding or mirroring code was left to remove — TASK-29 to TASK-33 had taken it all.

Both READMEs gained a 'Two directories: content/ and data/' section: what is in each, what to back up (`users.json`, `keys/`), what may be deleted (`geekity.db*`, `images/`), a table of every database table against where it comes back from, the three things a rebuild actually costs, and the one capability decision-9 gives up. doc-1 was updated through the CLI to match.

## Decisions

- **Three verdicts on an existing database, and only one of them is automatic.** A ledger recording a version this package does not ship is a downgrade and refuses the boot; a file SQLite will not open is damaged and refuses too. Both name the file and both ways out. The reason neither is cleaned up automatically is the one thing this milestone could not afford to get wrong: a database from before decision-9 still carries the `settings`, `actor_keys` and `users` rows the boot migrations write out as files, and deleting one because an error came out of it would destroy an actor's private keys. A database *older* than the oldest migration still shipped is the case that is thrown away without asking, because there is by definition no path forward from it — that is `OutdatedDatabaseError` and `withRebuiltDatabase`. It cannot arise today, since every migration from version 1 is still shipped; the rule is the promise for the day one is pruned, and it is tested directly against a synthetic ledger rather than through a boot.
- **The check lives in the migration loop, not in a preflight.** Every opener is covered — the CLI's `user add`, a test's bare `openAdminStore` — rather than only `createCms`, and the ahead/behind comparison is per ledger, which is what the two ledgers in one file need.
- **'Ahead' is a version above the newest shipped, not merely one not shipped.** An applied version *below* the oldest shipped is the pruned case, and reading it as a downgrade would refuse exactly the database the milestone promises to rebuild.
- **`geekity rebuild` refuses a database in use, and `SQLITE_BUSY` is how it knows.** `PRAGMA locking_mode = EXCLUSIVE` plus `BEGIN IMMEDIATE` is refused busy exactly when another connection is attached to the WAL, which is a cheap and honest answer where a lock file would need cleaning up after a crash and a `-wal` check would say yes to a database nobody has open. Only `SQLITE_BUSY`/`SQLITE_LOCKED` count: a file that will not open at all is the case the command exists for, so it lets the rebuild proceed. That is what makes `rebuild` the way past both refusals above.
- **The command knows nothing about how to build an index.** It deletes and then boots, so a rebuilt database cannot differ from a booted one.
- **The counts come off `cms.admin`.** `createCms` already ran the federation rebuild; asking the store what it now holds is the honest report and needs no second connection.
- **The public API grew by six names, not twelve.** `databaseFile`, `databaseFiles`, `DATABASE_SUFFIXES`, `discardDatabase` and the two error classes are things a deploy script has a use for; `applyMigrations`, `openDatabase`, `withRebuiltDatabase` and the ledger types stay inside the package, because a site has no business running somebody else's ledger.
- **No table needed removing.** A fresh database after boot holds `documents`, `document_tags`, `document_categories`, `followers`, `ap_inbox`, `sessions`, `ap_deliveries`, `ap_relays`, `cms_state`, the two ledgers and `sqlite_sequence` — every one either read back from the files or a documented cache. The two that are neither derived nor a cache in the ordinary sense, `ap_relays` and `cms_state`, are justified in both READMEs with what losing them costs.

## Mutation checks

- `rebuildFederationIndexes` a no-op -> only the delete-and-boot comparison in `rebuild.test.ts` (the followers collection came back with `totalItems: 0`).
- `findImageVariant` never regenerating -> only the same test, at the variant request (404).
- `databaseInUse` always false -> only 'refuses while a server holds the database, and leaves it where it is'.
- The ahead check reading 'not shipped' rather than 'above the newest shipped' -> 'refuses a database that is too old to carry forward' failed while the downgrade test passed, which is what found the ordering bug.

## Validation

`pnpm build`, `pnpm test` (1039 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:11ty` (11 + 5) and `pnpm fed:smoke` all pass from the repo root.

## Manual pass on port 3000

`apps/demo/server.ts` over a scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in, plus a post carrying a picture and an `activitypub.id`, a `followers.json` naming Ada and one inbox line). `apps/demo/data` was never opened.

- **AC #1 and AC #3.** Captured `/ap/actor`, `/ap/actor/followers` and its page, `/ap/actor/outbox` and its page, `/ap/posts/a-picture`, the post page, the home page and `/feed/`. Killed the server, deleted `geekity.db`, `-wal`, `-shm` and `data/images`, leaving `keys/` and `users.json` alone, and booted again with no database at all. `diff -r` over the two capture directories reported no difference: every one of them byte for byte identical. Signing in as the user `geekity user add` had written succeeded (303 to `/admin`) and `/admin/federation` showed Ada, her like and 'Nothing recorded.' against the deliveries.
- **AC #6.** On that second, genuinely cold boot the first render of the post was the plain `<img>`; the request for `/uploads/_/2026/09/geekity-icon.png/300.webp` came back 200 `image/webp` at the same 2916 bytes as before the delete, having derived the set again; the render after it was the `<picture>` with its `<source>`, identical to the first boot's.
- **AC #2.** `geekity rebuild` with the server stopped printed 'Rebuilt …/geekity.db from the files. / Scanned 10: 10 created, 0 updated, 0 removed, 0 unchanged, 0 failed / Indexed 1 follower and 1 inbox activity.' and left a different inode. Run with the server up it exited 1 with 'is in use: something else has it open, most likely the site itself' and the file was untouched.
- **AC #4.** After the rebuild, `sqlite_master` held exactly the eleven tables plus `sqlite_sequence`, and `sessions`, `ap_deliveries`, `cms_state` and `ap_relays` were all empty while `documents` was 10, `followers` 1 and `ap_inbox` 1.
- **The two refusals.** An `admin_migrations` row for version 99 made `geekity sync` exit 1 with the downgrade message naming the file and both fixes; `geekity rebuild` then rebuilt it. Overwriting the file with plain text made `sync` exit 1 with 'could not be opened as a database (file is not a database)' and the same suggestion; `rebuild` got past that too.

Port 3000 was left clear.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed decision-9's loop. `src/cache.ts` now owns the SQLite file — its name, its two migration ledgers, and what happens to one this version cannot use — and both stores open through it. A missing database is built and read back out of `content/` and `data/` with no manual step; one older than the migrations still shipped is thrown away and rebuilt; one written by a newer @geekity/cms, or one SQLite will not open, refuses the boot naming the file and both ways out, because a pre-decision-9 database still carries the rows the boot migrations turn into the actor's key files. `geekity rebuild` is the door for those two: it refuses while something holds the database (SQLITE_BUSY under an exclusive lock), deletes geekity.db with its -wal and -shm, and boots — the same migrations, the same federation rebuild, the same scan — reporting the documents, followers and inbox activities it read back. Both READMEs and doc-1 gained the two-directory model: what is published in content/, what is private in data/ (users.json, keys/), what may be deleted (geekity.db*, images/), a table of every database table against where it comes back from, the three things a rebuild costs (logins, relay handshakes, a post that came due while the site was down) and the one capability given up — a post whose file is gone cannot be tombstoned. Verified by `packages/cms/src/rebuild.test.ts`, which boots a populated federated site, captures the actor, both follow collections, the outbox, the post object, the settings and federation screens, a login, the rendered post and a derived image's bytes, deletes the database and data/images, boots again and asserts every capture identical (only the per-session CSRF token is normalised); by six `geekity rebuild` tests in cli.test.ts and ten in cache.test.ts; and by a manual pass on port 3000 where `diff -r` over the two capture directories found no difference, a cold boot rendered the plain img then the picture once a variant request had derived the set again, and rebuild both refused a running server and got past a version-99 ledger and a corrupted file. pnpm build, test (1039 + 11), typecheck, lint, format:check, test:11ty and fed:smoke all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
