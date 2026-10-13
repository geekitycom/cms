---
id: TASK-385
title: 'Spike: what it takes to make the content and admin stores async'
status: To Do
assignee: []
created_date: '2026-10-13 12:10'
updated_date: '2026-10-13 15:29'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-52 -
    A-site-is-one-container-and-its-directory-foundational-systems-sit-behind-async-interfaces-a-build-can-swap.md
priority: low
type: spike
ordinal: 344800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 keeps a future Aurora (Postgres) build possible. ContentStore (content/store.ts) and AdminStore (store/admin-store.ts) are synchronous because node:sqlite is, and every Postgres driver is async, so such a build would need both interfaces to return promises. That change reaches every caller, up through routes and template rendering. This spike measures how far before anyone commits to it. Search is SQLite FTS5 behind SearchReader, and a rebuild deletes the database file (cache.ts rebuildingIfOutdated); both would differ on Postgres. Nothing is built for Postgres.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The record counts the call sites and files that change if each store method returns a promise, by layer (routes, templates, services, plugins API), with the method of counting so it can be rerun
- [ ] #2 The record says whether the theme template engine and the plugin API can await store calls, and what breaks for published themes and plugins
- [ ] #3 The record says how search and rebuild would work behind the interfaces on Postgres, on paper
- [ ] #4 The record recommends a sequence of verifiable steps, or recommends not doing it until there is a real need, with reasons; follow-up tasks are filed only if it recommends going ahead
- [ ] #5 The user has read the decision record and accepted it, or asked for changes that are made; follow-up build tasks are not started before then
<!-- AC:END -->
