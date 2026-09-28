---
id: TASK-138
title: Fingerprinted theme assets with immutable caching
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - performance
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/cache-control/'
priority: medium
type: enhancement
ordinal: 162800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Theme assets are served with max-age=3600 and uploads and image variants with max-age=86400, none of them immutable, and style.css has no version in its URL. Readers re-validate assets they already have, and a theme change can take up to an hour to show. Content-hashed URLs let every asset be cached for a year and still update the moment it changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Theme templates can reference an asset through a helper that returns a URL containing a content hash
- [ ] #2 Hashed asset URLs are served with Cache-Control: public, max-age=31536000, immutable; the unhashed URL keeps working with a short max-age
- [ ] #3 Image variants, whose names never change content, are served immutable
- [ ] #4 The default theme uses the helper for every stylesheet and script
- [ ] #5 Editing a theme file in development changes its URL without a restart
<!-- AC:END -->
