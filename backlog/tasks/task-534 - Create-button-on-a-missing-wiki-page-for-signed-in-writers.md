---
id: TASK-534
title: Create button on a missing wiki page for signed-in writers
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-531
  - TASK-532
references:
  - decision-66
ordinal: 436800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: a [[link]] to a page that does not exist yet is how a wiki grows. Visitors get a 404; a signed-in writer who follows the link should be one click from writing the page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A request for `/<wiki_base>/<slug>/` with no published wiki page is a 404 for visitors, as today
- [ ] #2 For a signed-in user who can write, the 404 offers "Create <title>" linking to `/admin/wiki/new` with the slug and a title made from it (dashes to spaces, first letter capitalised); a draft at that slug links to its editor instead
- [ ] #3 The default theme 404 layout draws the button; the .md and .gmi 404s do not
<!-- AC:END -->
