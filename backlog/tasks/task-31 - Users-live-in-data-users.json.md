---
id: TASK-31
title: Users live in data/users.json
status: To Do
assignee: []
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 00:19'
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
- [ ] #1 First-run setup, the users screen (add, change password, delete) and geekity user add all read and write data/users.json and behave exactly as before
- [ ] #2 Login verifies against the hash in the file, and a session survives a database rebuild only as far as the file still holds its user
- [ ] #3 A database with users rows and no users.json is migrated on first boot and the table dropped; a test proves an existing user can still log in after that boot
- [ ] #4 The file is written with 0600 permissions and is never placed under content/
- [ ] #5 Adding a user with a name the file already holds is refused exactly as the unique index refused it
<!-- AC:END -->
