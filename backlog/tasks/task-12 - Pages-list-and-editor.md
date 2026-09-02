---
id: TASK-12
title: 'Pages: list and editor'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-11
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same flow as posts for content/pages: no date prefix in filename, no tags, optional eleventyExcludeFromCollections flag, default permalink /{slug}/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Creating a page writes content/pages/{slug}.md and serves it at its permalink
- [ ] #2 Trash and restore work as for posts
- [ ] #3 The page list shows title, author, updated date, and status
<!-- AC:END -->
