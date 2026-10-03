---
id: TASK-233
title: >-
  Read posts: webmention the read-of url, show the read line in feeds, keep the
  summary in step
status: To Do
assignee: []
created_date: '2026-10-03 13:04'
labels:
  - micropub
  - indieweb
  - feeds
dependencies: []
priority: medium
type: bug
ordinal: 248800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gaps left by TASK-229 (read posts), recorded in its notes. (1) A read-of url is not sent a webmention, unlike the like-of, repost-of and bookmark-of citations (targetsOf in src/webmention/service.ts adds citations). (2) Feeds print a read post's summary, not the read line the page and the federated Note show; a reader sees indiebookclub's summary or nothing. (3) indiebookclub stores a summary such as 'Want to read: Title by Author'; a later update of read-status to finished leaves that summary, so the post and its description disagree. Decide whether a read post's summary is derived from the read (and not stored), or replaced when read-status changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Publishing a read post whose read-of has a url sends that url a webmention, as a citation does
- [ ] #2 RSS, Atom and JSON Feed items for a read post open with the same read line the page shows; FEED_ITEM_REVISION is bumped
- [ ] #3 After read-status changes, nothing the site publishes still says the old status
- [ ] #4 Tests cover each
<!-- AC:END -->
