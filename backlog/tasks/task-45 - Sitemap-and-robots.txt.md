---
id: TASK-45
title: Sitemap and robots.txt
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-5
  - TASK-36
references:
  - 'https://www.sitemaps.org/protocol.html'
type: feature
ordinal: 27850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serve `/sitemap.xml` listing every public post and page (absolute URL and `lastmod` from `updated` or `date`), the home page, the paged listings, and every tag and category archive under the configured bases, split into a sitemap index when a single file would pass the protocol's limits. Serve `/robots.txt` allowing everything public, disallowing `/admin/`, and pointing at the sitemap. Both are fixed routes like the feeds, respect drafts, trash and scheduled posts, and send ETag and Last-Modified like the feeds do. The base layout does not need to link the sitemap; robots.txt does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /sitemap.xml validates against the sitemap protocol and lists every public post, page, listing page and taxonomy archive with lastmod, and nothing that is a draft, trashed or scheduled
- [ ] #2 /robots.txt disallows /admin/ and names the sitemap URL
- [ ] #3 Both answer conditional requests with 304 and change when content changes
<!-- AC:END -->
