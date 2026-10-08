---
id: TASK-291.4
title: 'WordPress import: redirects for every URL shape WordPress answered'
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
updated_date: '2026-10-08 11:51'
labels: []
milestone: m-31
dependencies:
  - TASK-282
parent_task_id: TASK-291
ordinal: 251800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Links from elsewhere use URL forms WordPress answers and Geekity does not: /?p=ID, /?page_id=ID, a post's old slug, and an attachment page. The import declares redirects for each, so none of those links breaks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /?p=ID and /?page_id=ID answer 301 at the permalink for every imported post and page
- [ ] #2 Each _wp_old_slug becomes a redirect_from entry on its post
- [ ] #3 An attachment page URL answers 301 at its file under /uploads/
- [ ] #4 Redirects the import writes are kept apart from ones the site declared by hand, so a rerun never drops a hand-written one
<!-- AC:END -->
