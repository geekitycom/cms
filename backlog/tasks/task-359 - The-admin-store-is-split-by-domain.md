---
id: TASK-359
title: The admin store is split by domain
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
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
- [ ] #1 Each domain has its own store module taking the database; openAdminStore composes them and AdminStore stays one type
- [ ] #2 Schema migrations live in their own module
- [ ] #3 One-time legacy migrations (settings, users, actor keys) live in one module that takes the raw database, outside the AdminStore interface
- [ ] #4 Status counts use one zero-filling helper
- [ ] #5 An existing database opens and migrates exactly as before
<!-- AC:END -->
