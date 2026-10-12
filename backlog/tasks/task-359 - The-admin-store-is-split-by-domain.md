---
id: TASK-359
title: The admin store is split by domain
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 01:08'
labels: []
milestone: m-35
dependencies:
  - TASK-358
type: chore
ordinal: 318800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
admin/store.ts is 2905 lines: about 71 methods and 72 prepared statements over sessions, tokens, flash, state, followers, profiles, the inbox, comments, deliveries, webmentions and relays, with legacy-table migration methods in the public interface and the whole migration list inline. Three GROUP BY status counters each hand-roll zero filling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each domain has its own store module taking the database; openAdminStore composes them and AdminStore stays one type
- [x] #2 Schema migrations live in their own module
- [x] #3 One-time legacy migrations (settings, users, actor keys) live in one module that takes the raw database, outside the AdminStore interface
- [x] #4 Status counts use one zero-filling helper
- [x] #5 An existing database opens and migrates exactly as before
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test first: countByStatus(rows, statuses) zero-fills every status and sums rows, folding unknown statuses through the domain's fallback reader.
2. Schema-equivalence test before the split: capture sqlite_master, user_version and the admin_migrations ledger versions from a fresh database opened by the current code into a golden fixture; assert a fresh open matches it and that a database stopped at every migration step (1..26) opens to the same schema. Also check by hand that a database built by v0.30.0 (git worktree) opens with the new code to the golden schema.
3. Split admin/store.ts into admin/store/: rows.ts (shared row helpers, countByStatus, inTransaction), schema.ts (LEDGER, MIGRATIONS, openAdminDatabase), conversation.ts (write listeners), sessions.ts (sessions + flash), tokens.ts (password resets + spent tokens), state.ts, followers.ts, profiles.ts (actor profiles + avatar sources), inbox.ts, comments.ts, deliveries.ts, webmentions.ts, relays.ts. Each exports an interface and an open function over (db, ...). admin/store.ts keeps openAdminStore, composes the domain stores, and re-exports their types; AdminStore is the intersection, so callers do not change.
4. Legacy tables: one module admin/legacy-migrations.ts (git mv from settings-migration.ts) holding the Legacy* types, the readers over a raw DatabaseSync, dropLegacyTable, and migrateSettingsToFile / migrateActorKeysToFiles / migrateUsersToFile, each taking the database. Remove the four legacy methods from AdminStore. boot.ts and cli.ts open the admin database with openAdminDatabase and build the store over it with adminStoreOver so the migrations get the raw connection. users-migration.ts goes; federation/keys.ts loses its migration.
5. Move the legacy store tests to the new module; run pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Layout: admin/store.ts composes per-domain modules under admin/store/ (sessions, tokens, state, followers, profiles, inbox, comments, deliveries, webmentions, relays, conversation, rows, schema). AdminStore is the intersection of the domain interfaces plus file/setReadOnly/close, so callers are unchanged. openAdminStore(options) still opens; openAdminDatabase(dataDir) + adminStoreOver(db, file) let boot.ts and cli.ts run the legacy migrations on the store's own connection.
Legacy: admin/legacy-migrations.ts (git mv from settings-migration.ts) holds LegacySetting/LegacyActorKey/LegacyUser, the raw-database readers, dropLegacyTable, and migrateSettingsToFile / migrateActorKeysToFiles / migrateUsersToFile, each now (db, dir). users-migration.ts is gone; federation/keys.ts lost its migration and exports KEY_FILE_MODE and ensureKeysDir for it.
Breaking public API: AdminStore no longer has legacySettings/legacyActorKeys/legacyUsers/dropLegacyTable; the three migrate* exports take (db: DatabaseSync, dir) instead of { admin, dir }. New exports: openAdminDatabase, adminStoreOver.
countByStatus (store/rows.ts) zero-fills the three GROUP BY counters. One tiny difference: countSentWebmentionsByStatus used '=' per row, so two unknown statuses folding into 'failed' overwrote each other; they now add up like the other two counters. relayState/deliveryStatus now use oneOf.
Schema proof: store/__fixtures__/schema.json is sqlite_master + user_version + ledger from a fresh database made by the pre-split code; v0.30.0 (git worktree) produced byte-identical JSON, fresh and after its boot migrations. store/schema.test.ts asserts a fresh open matches it, a database stopped at each of migrations 1..25 opens to it, and the legacy migrations remove only settings/actor_keys/users. Mutation check: deleting one CREATE INDEX from a migration fails all three. By hand: databases created by v0.30.0 (fresh and booted) opened with the new code give the same sqlite_master, user_version and ledger as v0.30.0 itself.
Validation: pnpm build, pnpm test (cms 5602 pass, all packages green), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the 2900-line admin/store.ts into per-domain modules under admin/store/, each opened over the database; admin/store.ts composes them into AdminStore (an intersection type, so no caller changed). Migrations moved to store/schema.ts with openAdminDatabase. The settings, actor-key and users legacy migrations now live together in admin/legacy-migrations.ts and take the raw DatabaseSync; the four legacy methods left AdminStore (breaking for the public type and the three migrate* signatures). The three status counters use one countByStatus helper. Verified with rows.test.ts, a schema-equivalence test against a fixture captured from the pre-split code (identical to v0.30.0's), databases stopped at every migration, a by-hand open of v0.30.0-created databases, and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
