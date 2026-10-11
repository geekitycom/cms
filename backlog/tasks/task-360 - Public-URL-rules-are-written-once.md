---
id: TASK-360
title: Public URL rules are written once
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-35
dependencies:
  - TASK-359
type: chore
ordinal: 319800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/routes.ts (2135 lines) holds the router, URL grammar, Markdown, sitemap, llms.txt and embed builders. resolveRequest and canonicalTarget each re-derive the URL grammar, and the extension branch repeats it a third time. Listing kinds (home, tag, category, author) are branched on in about six functions. listing() and search() duplicate the pager and caching tail. frontPages(c) is recomputed at about 10 call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One path classifier is used by request resolution, canonical redirects and the extension routes
- [ ] #2 Listing kinds are one modelled type that owns its count, list, href, feed href and title
- [ ] #3 Paged responses share one caching helper
- [ ] #4 Front pages, taxonomy bases and authors are resolved once per request
- [ ] #5 routes.ts is split by concern (paths, Markdown, sitemap and llms.txt, embed)
- [ ] #6 Every existing route test passes unchanged
<!-- AC:END -->
