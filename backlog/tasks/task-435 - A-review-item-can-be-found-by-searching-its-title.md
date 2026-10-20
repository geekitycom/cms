---
id: TASK-435
title: A review item can be found by searching its title
status: To Do
assignee: []
created_date: '2026-10-20 01:15'
labels:
  - admin
milestone: m-40
dependencies:
  - TASK-434
priority: medium
ordinal: 372800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Above the review item's fields, a "Find the book/movie/show/album/place" box searches by title, so the author does not have to find the link in another tab first. Sources by kind: Open Library for books, TMDb for movies and TV, MusicBrainz release groups for albums, and OpenStreetMap (Nominatim) for places. Picking a match fills the item as Look up does. The mockup shows the result list: _local/editor-mockups/a-picker.html#review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typing a title into the find box lists matches from the source for the chosen kind, each with a small picture, the title, by and year (or the address for a place), and the source
- [ ] #2 Picking a match fills the ID, details and picture as Look up does
- [ ] #3 The list says where to paste a link when the item is not found
- [ ] #4 Requests are debounced and respect each source's rate limit and terms; Nominatim gets a User-Agent and at most one request a second
- [ ] #5 Other has no find box; the box is absent without JavaScript and the form still works
<!-- AC:END -->
