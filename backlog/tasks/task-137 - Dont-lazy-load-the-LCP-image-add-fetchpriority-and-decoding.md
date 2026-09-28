---
id: TASK-137
title: Don't lazy-load the LCP image; add fetchpriority and decoding
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - performance
  - images
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/lazy-loading/'
  - 'https://specification.website/spec/performance/image-optimization/'
  - 'https://specification.website/spec/performance/core-web-vitals/'
priority: high
type: bug
ordinal: 161800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/images/markup.ts adds loading=lazy to every image, including the first image on a post, which is usually the Largest Contentful Paint element. Lazy-loading the LCP image delays it measurably. The first image in a single post or page should load eagerly with fetchpriority=high. Every image should also get decoding=async.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a single post or page, the first content image has no loading=lazy and has fetchpriority=high
- [ ] #2 Images after the first, and all images on listing pages beyond the first entry, keep loading=lazy
- [ ] #3 Every generated img carries decoding=async
- [ ] #4 Tests cover a post with one image, several images, and a listing
<!-- AC:END -->
