---
id: TASK-31
title: Users live in data/users.json
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 16:49'
labels:
  - admin
milestone: m-4
dependencies:
  - TASK-9
  - TASK-27
  - TASK-29
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-5 - Admin-UI.md
type: task
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move users out of the `users` table into `data/users.json`: one entry per user with id, username, Argon2 hash, and created time, written atomically with 0600 permissions. Login, first-run setup, the users screen, `geekity user add` and password changes all read and write the file. Sessions stay in SQLite as a cache and keep referencing user ids. Existing rows are migrated to the file once on first boot, then the table is dropped. Usernames stay unique and case rules stay as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 First-run setup, the users screen (add, change password, delete) and geekity user add all read and write data/users.json and behave exactly as before
- [x] #2 Login verifies against the hash in the file, and a session survives a database rebuild only as far as the file still holds its user
- [x] #3 A database with users rows and no users.json is migrated on first boot and the table dropped; a test proves an existing user can still log in after that boot
- [x] #4 The file is written with 0600 permissions and is never placed under content/
- [x] #5 Adding a user with a name the file already holds is refused exactly as the unique index refused it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all public: the new src/admin/accounts.ts, which owns data/users.json (a user is created, read back, verified, given a new password and deleted through it; the file is 0600 and sits in dataDir, never under contentDir; a duplicate name is refused; two concurrent adds of one name cannot both win); app.request against a real CMS (first-run setup writes the file, login verifies against the hash in it, the users screen adds, changes a password and deletes, and a session whose user is no longer in the file is not signed in); a boot over a database built in the old shape (a users table with rows and no users.json), proving the rows reach the file, the table goes and that user can still log in; and cli.test.ts over geekity user add.

2. src/admin/accounts.ts is the module that owns the file, as federation/keys.ts owns data/keys. It carries User, StoredUser, CreateUserInput and DuplicateUsernameError, moved out of admin/store.ts, plus usersFile(dataDir), listUsers, countUsers, findUser, findUserById and verifyUserPassword (synchronous reads of the file, as readSiteSettings is a read of site.json per call, so nothing anywhere can hold a stale copy), and createUser, setUserPassword and deleteUser, which write through updateFileAtomically at { mode: 0o600 }. The uniqueness rule moves inside the update callback, so it is checked and the write made as one step and two concurrent adds cannot both succeed. Usernames stay compared exactly, which is what the BINARY unique index did. The file is { users: [...], nextId } pretty-printed with a trailing newline; nextId means a deleted id is never handed to somebody else.

3. Sessions stay in SQLite and keep their user_id, but the foreign key cannot: with foreign_keys ON, dropping users would cascade every login away and an INSERT afterwards would fail with 'no such table: main.users'. Migration 11 therefore recreates sessions without the constraint and copies every row across, before migrateUsersToFile drops the table, so a site upgrading keeps its logins. What the key was doing is done in the guard instead: a session naming a user the file does not hold is deleted and the request is anonymous, which is AC #2 exactly — a session survives a rebuilt database only as far as the file still holds its user. deleteUser on the screen ends that user's sessions itself, which is what the cascade used to do.

4. migrateUsersToFile({ admin, dataDir }) in accounts.ts, run in createCms after migrateActorKeysToFiles, reads the rows through a new AdminStore.legacyUsers() (prepared lazily behind hasTable, like legacySettings and legacyActorKeys), writes them out with writeFileAtomicallySync at 0600 only when the file is absent (files win), keeping their ids so a live session still names its user, and then drops the table unconditionally. Migration 1 stays byte-identical; only its comment gains the note that a fresh database creates the table and the boot migration drops it a moment later. geekity user add runs the same migration before it writes, since it is the one door that can reach the file before a boot ever has.

5. AdminStore loses countUsers, listUsers, getUser, getUserById, createUser, verifyPassword, setPassword and deleteUser with their prepared statements (a SELECT over a dropped table throws when it is prepared) and gains legacyUsers(). Callers take the data directory instead: routes.ts (setup, login, the guard, the chrome's user), users.ts (the whole screen), documents.ts and preview.ts (the author's name), federation.ts (the nodeinfo user count) and cli.ts.

6. Tests: accounts.test.ts is new; users.test.ts, routes.test.ts, store.test.ts and cli.test.ts move to the file; store.test.ts gains a legacyUsers describe beside the other two and a sessions-survive-the-migration one.

7. Docs: README's Users section (the cascade is no longer what deletes a login), its dataDir row and the settings paragraph that says users live beside the settings table; packages/cms/README's 'Users and sessions live in the same SQLite file' section and its createUser example; doc-1's line naming users as data with no natural file form, and doc-5's auth section. Then pnpm build, test, typecheck, lint, format:check from the root, and a manual pass on port 3000 over scratch directories: first-run setup, sign in, add a second user, change a password, ls -l the file, delete geekity.db under a live session and watch the session go but the login still work.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`packages/cms/src/admin/accounts.ts` is the new module that owns `data/users.json`, as `federation/keys.ts` owns `data/keys`. It carries `User`, `StoredUser`, `CreateUserInput` and `DuplicateUsernameError`, moved out of `admin/store.ts`, and the whole of what the users table used to do: `listUsers`, `countUsers`, `findUser`, `findUserById` and `verifyUserPassword` read the file synchronously per call (as `readSiteSettings` reads `site.json`), and `createUser`, `setUserPassword` and `deleteUser` write it through `updateFileAtomically` at `{ mode: 0o600 }`. The file is `{ users: [{ id, username, passwordHash, createdAt }], nextId }`, pretty-printed with a trailing newline.

`AdminStore` lost `countUsers`, `listUsers`, `getUser`, `getUserById`, `createUser`, `verifyPassword`, `setPassword` and `deleteUser` with their prepared statements, `User`, `StoredUser`, `CreateUserInput` and `DuplicateUsernameError`, and gained `legacyUsers()` and `LegacyUser`. Migration 11 rebuilds `sessions` without the foreign key, copying every row; migration 1 stays byte-identical and only its comment changed. `migrateUsersToFile({ admin, dataDir })` runs in `createCms` after `migrateActorKeysToFiles`, and again at the top of `geekity user add`.

Callers take the data directory instead of the store: `routes.ts` (setup, login, the guard, the chrome's user), `users.ts` (the screen), `documents.ts` and `preview.ts` (the author's name), `federation.ts` (the nodeinfo count) and `cli.ts`.

## Decisions

- **Sessions keep their user id and lose the foreign key.** With `foreign_keys` on, dropping `users` would cascade every login away, and an insert afterwards would fail with 'no such table: main.users' — so the constraint could not survive either way, and SQLite cannot drop one in place. Migration 11 rebuilds the table and copies every row, so a site upgrading keeps its logins; the manual pass signed in with a session id written before the upgrade. What the key was doing is done in the guard: `liveSession` deletes a session whose user `users.json` no longer holds and makes the request anonymous. That is AC #2 exactly — a login survives a rebuilt database only as far as the file still holds the person it was made for — and it is why restoring an old database cannot bring back a deleted account.
- **A damaged file stops the site rather than opening it.** A `users.json` that will not parse throws, naming the file and saying to restore or delete it, instead of reading as an empty list. Empty means first-run setup, where the next person to reach `/admin` becomes the admin: a corrupt file must never be an open door. The boot migration reads through the same parser, so a damaged file fails the boot.
- **`nextId` in the file rather than max + 1.** A deleted user's id is never handed to somebody else, so a session — or anything else naming a user by id — can only ever mean the person it was written for.
- **The uniqueness check is inside the write.** `createUser` looks for the name inside the `updateFileAtomically` callback, so the check and the write are one step behind the per-path queue and two concurrent adds cannot both win. That is the `UNIQUE` index's rule re-expressed over the file (AC #5). Names are still compared exactly, which is what the `BINARY` column did, and `listUsers` sorts by code unit, which is what `ORDER BY username` did.
- **Files win, wholesale.** The migration writes the rows out only when `users.json` is absent, so a database restored from a backup taken before the upgrade cannot undo a deletion or a password change. `geekity user add` runs the migration before it writes, because it is the one door that can reach the file before a server ever has — without that, adding a user on an un-upgraded site would leave a file holding nobody else, and the file would win on the next boot.
- **Deleting a user ends their sessions explicitly**, in the screen, since the cascade went with the table. A session that outlives that is not a login either, by the guard's join.
- **The store no longer hashes anything.** `hashPassword`, `verifyPasswordHash`, the dummy hash and `isUniqueViolation` moved out of `store.ts` or went with the code that used them.

## Mutation checks

Each mutation failed exactly the tests that name that behaviour, and nothing else:

- the guard's file join skipped -> only 'refuses a session whose user the file no longer holds'.
- `migrateUsersToFile` a no-op -> only the two boot-migration tests.
- migration 11 copying no rows -> only 'keeps the logins the database already held'.
- the duplicate check dropped from `createUser` -> both AC #5 tests, the users screen's duplicate test and the CLI's, and nothing else.

## Validation

`pnpm build`, `pnpm test` (960 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:11ty` (10 + 5) and `pnpm fed:smoke` all pass from the repo root.

## Manual pass on port 3000

A scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in) and `apps/demo/server.ts`. `apps/demo/data` was never opened.

- **AC #1.** First-run setup at `/admin/setup` created `data/users.json` and signed ada straight in. `/admin/users` added grace (303, 'Added grace.', both in the file and in the table on the screen); grace signed in through the login form and a wrong password came back 401. Ada changed her own password: the hash in the file changed, her second browser was signed out ('1 other session was signed out'), her own session and grace's were untouched. Deleting grace took her out of the file, ended her session (302) and said 'Deleted grace.'; deleting the last user was refused with 'only user. Add another before deleting this one.' `geekity user add katherine --password …` wrote her into the same file and she signed in through the form; a second add of that name exited 1 with 'already exists'. `/nodeinfo/2.1` counted the users out of the file.
- **AC #2.** Signed in, then killed the server, deleted `geekity.db`, `-shm` and `-wal`, and booted again on the same directories: the held cookie answered 302 to the login form — the session was in the database and went with it — while the login form accepted the account against the file, including the password changed before the deletion, and refused the old one with 401.
- **AC #3.** Rebuilt the database in the pre-upgrade shape (ledger back to version 10, a `users` table with ada at id 4, `sessions` recreated with the foreign key and a row naming her) and removed `users.json`, then booted. The file was written before any request arrived, 0600, with her id, hash and created time; `users` was gone from `sqlite_master`; the session id written before the upgrade answered 200 and rendered 'Signed in as ada'; and the login form accepted her password.
- **AC #4.** `ls -l` showed `-rw-------` on `data/users.json` after every one of those writes, in `dataDir` and never under `content/`.
- **AC #5.** Six concurrent `POST /admin/users` for one name: exactly one 303 and five 400s, one entry in the file. Five concurrent adds of five different names: five 303s, all five in the file with five distinct ids, so nothing was lost to a read-modify-write race. No `.tmp` file was left behind.

Port 3000 was released and the scratch directories deleted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Accounts are a file: `data/users.json`, one entry per user with id, username, argon2 hash and created time, written atomically at 0600, and the `users` table is gone.

The new `packages/cms/src/admin/accounts.ts` owns that file the way `federation/keys.ts` owns `data/keys`: it reads it synchronously per call, so nothing can hold a stale idea of who exists, and writes it through `updateFileAtomically`, which puts the read inside the write's queue — that is where the `UNIQUE` index's rule now lives, so two adds of one name at the same moment cannot both win. First-run setup, the login form, the users screen, `geekity user add` and password changes all go through it, names are still compared exactly and listings still sort by code unit. A `users.json` that will not parse is a loud failure naming the file rather than an empty list, because empty means first-run setup and an open door.

Sessions stay in SQLite, which is what makes the database disposable, and keep naming a user by id. The foreign key could not survive the table — dropping the parent would cascade every login away, and an insert afterwards would fail — so migration 11 rebuilds `sessions` without it, copying every row so a site upgrading keeps its logins, and the guard makes the join instead: a session naming somebody the file no longer holds is deleted on sight. That is what makes a login survive a rebuilt database only as far as the file still holds the person it was made for, and what stops a restored backup resurrecting a deleted account. A database that still has rows has them written out, ids and hashes intact, on the first boot — and by `geekity user add`, the one door that can reach the file before a server does — before the table is dropped; migration 1 stays exactly as it shipped.

Verified with 960 package tests (0 fail), 17 of them new over the file — creation, listing, 0600 in dataDir, duplicates including a race, verification, password changes, deletion and id reuse, a damaged file, the boot migration, the file winning over the rows, a login after the database is thrown away, and a session whose user has gone — each mutation-checked: skipping the guard's join, skipping the migration, letting migration 11 lose the rows and dropping the duplicate check each failed exactly the tests that name that behaviour. Then a manual pass on a real server on port 3000 over scratch directories covering all five criteria, including booting over a hand-rebuilt pre-upgrade database and signing in with a session id written before the upgrade, deleting `geekity.db` under a live login, and firing six concurrent adds of one name for exactly one 303. `pnpm build`, `test`, `typecheck`, `lint`, `format:check`, `test:11ty` and `fed:smoke` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
