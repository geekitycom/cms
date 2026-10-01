---
id: TASK-204
title: OpenSearch description for site search
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
labels:
  - search
  - theme
dependencies: []
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/layouts/search.njk
priority: low
type: feature
ordinal: 220800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Browsers can offer a site's own search from the address bar when the site publishes an OpenSearch description document and links it with <link rel="search" type="application/opensearchdescription+xml">. Serve /opensearch.xml built from the site's title, tagline, icon and the existing search URL (/search/?q={searchTerms}), with the right content type, and link it from every page's head. Nothing to configure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /opensearch.xml answers application/opensearchdescription+xml with ShortName, Description, the favicon as Image and a Url template pointing at /search/?q={searchTerms}
- [ ] #2 Every public page's head links it with rel="search"
- [ ] #3 The values follow site settings without a restart, and a base path is respected
- [ ] #4 A Chromium or Firefox browser offers the site as a search engine after visiting it, or the notes record what was checked
<!-- AC:END -->
