---
id: TASK-255
title: 'Show a reposted image URL as the image, credited to its host'
status: To Do
assignee: []
created_date: '2026-10-04 00:20'
labels:
  - theme
  - webmention
  - accessibility
dependencies:
  - TASK-252
priority: medium
type: feature
ordinal: 270800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A repost on shll.me (0.19.0, /2026/10/scientific-calculator/) cites a bare PNG on edu.casio.com, and the citation prints the whole ~300-character URL as its link text. When a cited URL answers with an image/* content type, keep it as the context's picture of kind photo, through TASK-252's copy path (guarded fetch, size cap, metadata stripped, its own uploads path), and show it in full like a reposted Giphy GIF. The citation line reads 'Reposted an image from <host>' linking to the original instead of printing the URL. The editor's preview card for an image gets an alt text field, defaulting to the post's title; with requireAltText on, a save with no alt text for it is refused like a photo without alt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A repost of a URL that answers image/* shows the copied image in full with 'Reposted an image from <host>' linking to the original, on its page and in listings
- [ ] #2 The editor's card for an image has an alt text field, defaulting to the post's title, written to the post; requireAltText refuses a save without it
- [ ] #3 An image over the size cap or a failed fetch leaves the citation as a link showing the host, not the full URL; tests use stubbed hosts
<!-- AC:END -->
