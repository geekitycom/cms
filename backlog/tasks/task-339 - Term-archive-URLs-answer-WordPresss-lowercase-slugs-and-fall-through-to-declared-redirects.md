---
id: TASK-339
title: >-
  Term archive URLs answer WordPress's lowercase slugs and fall through to
  declared redirects
status: To Do
assignee: []
created_date: '2026-10-10 23:01'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/web/taxonomy.ts
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/urls.tsv
priority: high
ordinal: 298800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found building the andrewshell.org redirect generator (asdo_geekity scripts/redirects, phase 4). Two gaps in taxonomy routing. (1) Case. Geekity serves a term's archive at the term's exact spelling: /category/rssCloud/, /category/AI/, /category/WordPress/. WordPress served them at their lowercase slugs: /category/rsscloud/, /category/ai/, /category/wordpress/, and their feeds (the baseline has /category/rsscloud/feed/, a feed people subscribe to; feed-guids.tsv category_rsscloud_feed.xml). Those 3 archives and 3 feeds now 404. taxonomyRedirects would paper over it, but it is documented for renamed terms, and these were not renamed: WordPress slugs are lowercase by design, so every WordPress import with a mixed-case term hits this. (2) Shadowing. taxonomyArchive and parseFeedPath claim every /{base}/{term}/ path and its feeds, even for a term nothing carries, and answer 404 before declared redirects run. So the migration's entries for /category/general/, /category/general/feed/, feed/atom/ and feed/rss/ (D5 dropped the General category) never answer. feed/rdf/ and feed/rss2/ do. taxonomyRedirects can't express 'go to /'. Proposal: a request for a term archive or its feed matches the term case-insensitively and answers 301 to the canonical spelling (or serves it, decided in the task); a term path naming no term in use falls through to the next handler, so a declared redirect can answer it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /category/rsscloud/ and /category/rsscloud/feed/ reach the rssCloud archive and feed (301 to the canonical spelling, or served there), and the same for tags and every feed variant
- [ ] #2 A term archive or feed path for a term no published post carries falls through to declared redirects and taxonomyRedirects before answering 404
- [ ] #3 On the andrewshell.org site, /category/general/ and all its feed variants answer the 301 to / declared in content/_data/redirects/legacy.json
- [ ] #4 The README's taxonomy section documents case matching and the fall-through
<!-- AC:END -->
