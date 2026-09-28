---
id: TASK-139
title: Compress text responses (brotli and gzip)
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - performance
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/compression/'
  - 'https://specification.website/spec/performance/vary/'
priority: medium
type: feature
ordinal: 163800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Node sends every response uncompressed and leaves compression to a reverse proxy, but deploy/compose.yaml includes no proxy, so a site deployed as documented may serve raw HTML, CSS, feeds and JSON. The CMS should compress text responses itself, with a switch to turn it off for sites whose proxy already compresses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 HTML, CSS, JS, feeds, JSON, Markdown, SVG and sitemaps are compressed with brotli when accepted, otherwise gzip
- [ ] #2 Images, video and already-compressed types are never recompressed; very small responses are sent uncompressed
- [ ] #3 Vary: Accept-Encoding is added, ETags stay correct across encodings, and 304s still work
- [ ] #4 Compression can be disabled in config, and the Docker docs say when to do so
<!-- AC:END -->
