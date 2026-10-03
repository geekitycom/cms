---
id: TASK-232
title: ActivityStreams request for a post answers 500 on a site with no users
status: To Do
assignee: []
created_date: '2026-10-03 12:48'
labels:
  - federation
dependencies: []
priority: low
type: bug
ordinal: 247800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-227: on a site with no user accounts, requesting a post URL with an ActivityStreams Accept header answers 500 instead of 404. It happens for public posts too, so it predates TASK-227. A site with no users has no actor to attribute the object to; the object dispatcher (src/federation/federation.ts setObjectDispatcher, src/federation/article.ts) should answer 404 rather than throw.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With no users, an ActivityStreams request for a post URL answers 404, proven by a test
- [ ] #2 With users, the response is unchanged
<!-- AC:END -->
