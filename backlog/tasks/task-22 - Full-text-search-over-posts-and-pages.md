---
id: TASK-22
title: Full-text search over posts and pages
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
updated_date: '2026-09-05 12:41'
labels:
  - web
  - content
dependencies:
  - TASK-6
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred past phase one. Add an SQLite FTS5 table maintained by the sync layer, a /search route that negotiates HTML and JSON, and a theme search form. Captured now so the index schema and sync events stay search-friendly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /search?q=term returns matching published posts and pages ranked by relevance
- [ ] #2 The FTS index is rebuilt as part of the boot scan and updated on every sync event
- [ ] #3 Drafts and trashed documents are never returned
<!-- AC:END -->
