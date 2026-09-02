---
id: TASK-14
title: Settings screen with content/_data/site.json mirror
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings table in SQLite and a form at /admin/settings for site title, tagline, base URL, timezone, posts per page, actor handle, and actor type. On save, mirror the public subset to content/_data/site.json so an Eleventy build sees the same values. The theme reads settings for the site header and metadata.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Saving settings updates the site title shown on the public site
- [ ] #2 content/_data/site.json is rewritten on save and contains title, tagline, url, and author
- [ ] #3 Posts per page setting changes home page pagination
- [ ] #4 Base URL is validated as an absolute http(s) URL
<!-- AC:END -->
