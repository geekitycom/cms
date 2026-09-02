---
id: TASK-3
title: SQLite content index with query API
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-1
references:
  - >-
    backlog/decisions/decision-1 -
    Markdown-files-are-the-source-of-truth-SQLite-is-a-derived-index.md
type: feature
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the derived index described in decision-1. Schema: documents keyed by path with type, slug, permalink, title, date, updated, draft, description, author, tags (join table), front matter JSON, markdown, html, and hash. Migrations run on boot. Expose a small typed store: upsert, remove, getByPermalink, getBySlug, listPosts (published, paginated, newest first), listByTag, listAll for admin, and counts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Boot on an empty data dir creates the database and applies migrations idempotently
- [ ] #2 upsert followed by getByPermalink returns the same Document fields
- [ ] #3 listPosts excludes drafts and trashed documents and paginates with page size and offset
- [ ] #4 listByTag returns posts carrying that tag ordered newest first
- [ ] #5 Permalink lookups are indexed and unique; inserting a second document with the same permalink fails clearly
<!-- AC:END -->
