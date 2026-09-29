---
id: TASK-168
title: Micropub syndicate-to from the site's syndication targets
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - webmention
  - indieweb
milestone: m-25
dependencies:
  - TASK-155
  - TASK-164
  - TASK-167
references:
  - 'https://www.w3.org/TR/micropub/#syndication-targets'
priority: low
type: feature
ordinal: 192800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-155 gives a site a list of syndication targets and lets a post select them with a syndicate-to front matter list. Expose that list to Micropub clients so they can offer it as checkboxes: q=config and q=syndicate-to list each target's uid and name, and mp-syndicate-to on a create or update selects targets exactly as the editor checkbox does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 q=syndicate-to and q=config list every declared target with uid and name, and an empty list when none are declared
- [ ] #2 mp-syndicate-to on create writes the selected targets to the post, and the post is syndicated as an editor post would be
- [ ] #3 An unknown target uid gets 400 invalid_request naming it, and no file is written
- [ ] #4 An update can add or remove targets, with the same effect as changing the checkboxes in the editor
<!-- AC:END -->
