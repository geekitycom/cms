---
id: TASK-340
title: plugin-wordpress points the homepage's ?p= and ?page_id= at /
status: To Do
assignee: []
created_date: '2026-10-10 23:01'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/plugin-wordpress/README.md
priority: low
ordinal: 299800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found building the andrewshell.org redirect generator. The importer writes /?p=238 and /?page_id=238 → /home-page/ into _data/redirects/wordpress.json for the WordPress page that is the site's homepage. Core then answers /home-page/ with a 301 to / (a static homepage's own permalink redirects to /), so the old ids take two hops. Phase 4's check requires a single 301 to a 200, and the docs say the generator must write final targets. A site can't override the key from its own redirect file without repeating a from that wordpress.json declares. Proposal: when the importer sets homepage in site.json, it points that page's ?p= and ?page_id= redirects at / directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On an import whose WordPress homepage is page N, wordpress.json maps /?p=N and /?page_id=N to /
- [ ] #2 On the andrewshell.org import, /?p=238 and /?page_id=238 answer one 301 to /
<!-- AC:END -->
