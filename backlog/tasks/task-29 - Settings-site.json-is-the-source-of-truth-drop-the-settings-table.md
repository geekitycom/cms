---
id: TASK-29
title: 'Settings: site.json is the source of truth; drop the settings table'
status: To Do
assignee: []
created_date: '2026-09-04 00:18'
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
- [ ] #1 Saving the settings screen rewrites content/_data/site.json atomically and the public site, the feeds and the ActivityPub actor reflect the change without a restart
- [ ] #2 Editing site.json by hand while the server runs is reflected on the site and in the settings screen on the next request
- [ ] #3 The settings table no longer exists; an existing database with settings rows is migrated into site.json on first boot and the migration is proved by a test
- [ ] #4 A base URL from config or GEEKITY_BASE_URL still overrides the file's url at boot, and the settings screen still shows it read-only
- [ ] #5 Concurrent saves cannot interleave: writes to one file are serialised in process and a torn file is never observable
<!-- AC:END -->
