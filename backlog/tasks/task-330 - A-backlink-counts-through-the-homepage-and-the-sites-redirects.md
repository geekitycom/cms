---
id: TASK-330
title: A backlink counts through the homepage and the site's redirects
status: To Do
assignee: []
created_date: '2026-10-10 18:09'
labels:
  - themes
  - indieweb
dependencies:
  - TASK-322
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/webmention/links.ts
priority: low
type: enhancement
ordinal: 289800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-322 resolves a backlink by the target's permalink and redirect_from only. Two cases miss: a link to / does not count for the page set as the static homepage, because its permalink is not /; and a link through a declared redirect does not count, including the WordPress forms the import declares in _data/redirects/wordpress.json (/?p=ID, /?page_id=ID, old slugs), because the query is dropped and redirects are not consulted. A site migrated from WordPress is full of ?p= links between its own posts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A link to / counts as a backlink for the page the Reading setting makes the homepage
- [ ] #2 A link to any URL the site answers with a redirect to a document (redirect_from, _data/redirects.json, _data/redirects/*.json, including /?p=ID and /?page_id=ID) counts for that document, following the same resolution the site uses to redirect
- [ ] #3 A link whose redirect is later removed or retargeted stops counting or moves, without rewriting the linking post
- [ ] #4 Tests cover the homepage and a ?p= link from an imported post
<!-- AC:END -->
