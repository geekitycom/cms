---
id: TASK-367
title: 'The content index sits behind a repository interface, split by query family'
status: To Do
assignee: []
created_date: '2026-10-12 11:31'
labels: []
milestone: m-36
dependencies:
  - TASK-365
references:
  - packages/cms/src/content/store.ts
priority: medium
type: chore
ordinal: 326800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
openContentStore in packages/cms/src/content/store.ts is one 736-line closure over node:sqlite that owns schema and migrations, document upsert and removal, about 40 query methods (listByTag, listByAuthor, listBacklinks, search and others) and tag-spelling logic. Every caller depends on that one concrete object, so it changes for many unrelated reasons and nothing can stand in for it. Give callers small interfaces named for what they read, and split the implementation so each query family lives in its own module.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Callers outside content/ depend on interface types, not on the return type of openContentStore
- [ ] #2 Schema and migrations, writes, and each query family live in separate modules; no single function in the content index is longer than about 150 lines
- [ ] #3 node:sqlite is imported only by the content index implementation modules and cache.ts within content-related code
- [ ] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->
