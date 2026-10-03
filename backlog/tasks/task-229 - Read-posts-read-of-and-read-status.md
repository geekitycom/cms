---
id: TASK-229
title: 'Read posts: read-of and read-status'
status: To Do
assignee: []
created_date: '2026-10-03 01:32'
labels:
  - micropub
  - indieweb
  - interop
dependencies: []
priority: low
type: feature
ordinal: 244800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
indiebookclub (TASK-219) posts IndieWeb read posts as JSON: summary, read-status (to-read, reading, finished), read-of as an embedded h-cite {name, author?, uid?} where uid is isbn:... or doi:..., plus visibility and post-status. The site refuses read-of and read-status. TASK-219's indiebookclub notes give the proposed shape: front matter read-of and read-status, set from Micropub and the admin editor; Post Type Discovery gains read; the theme prints <data class="p-read-status"> and a p-read-of h-cite; federation is a Note with the sentence the page prints; q=config lists read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Micropub create with read-of (h-cite) and read-status publishes a read post, and q=source and update round-trip both
- [ ] #2 The admin editor sets read-of and read-status
- [ ] #3 The default theme prints p-read-status and a p-read-of h-cite with p-name, p-author and p-uid
- [ ] #4 The post federates as a Note whose content says what was read
- [ ] #5 indiebookclub's documented request (its templates/pages/documentation.twig example) answers 201 in a test
<!-- AC:END -->
