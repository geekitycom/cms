---
id: TASK-34
title: >-
  Disposable database: rebuild on boot, geekity rebuild, and the delete-and-boot
  test
status: To Do
assignee: []
created_date: '2026-09-04 00:19'
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
- [ ] #1 Booting with no database file rebuilds it from content/ and data/ without a manual step and the site serves identically
- [ ] #2 geekity rebuild deletes and rebuilds the database on demand and reports what it indexed
- [ ] #3 An integration test boots a fully populated federated site, deletes the database, boots again, and asserts the actor document, followers collection, outbox, settings screen and a login are identical
- [ ] #4 No table in the database holds state that cannot be rebuilt from files, other than sessions and delivery outcomes, and the README says so
- [ ] #5 The README documents what lives in content/, what lives in data/, what to back up, and that data/geekity.db may be deleted
<!-- AC:END -->
