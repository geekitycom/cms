---
id: TASK-7
title: Atom and JSON Feed for posts
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-5
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixed routes /feed.xml (Atom 1.0) and /feed.json (JSON Feed 1.1) over the most recent published posts, plus per-tag variants at /tags/{tag}/feed.xml. Feeds are not negotiated (doc-3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /feed.xml validates as Atom with entries carrying id, title, updated, link, and full HTML content
- [ ] #2 /feed.json validates against JSON Feed 1.1 with the same entries
- [ ] #3 The HTML layout advertises both feeds with link rel=alternate
- [ ] #4 Drafts never appear in feeds
<!-- AC:END -->
