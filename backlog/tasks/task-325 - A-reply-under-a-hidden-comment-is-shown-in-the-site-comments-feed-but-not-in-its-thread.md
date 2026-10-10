---
id: TASK-325
title: >-
  A reply under a hidden comment is shown in the site comments feed but not in
  its thread
status: To Do
assignee: []
created_date: '2026-10-10 13:39'
labels:
  - comments
  - feeds
dependencies: []
references:
  - packages/cms/src/web/conversation.ts
priority: medium
type: bug
ordinal: 284800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-318. When a comment is pending, spam or trashed, an approved reply under it is dropped from the post's thread and from the post's own comments feed (threadOf in web/conversation.ts walks from visible parents only), but conversation.latest() still lists it in /comments/feed/. Since TASK-318 it also has a page at /comment/{id}/ whose link to the whole conversation points at an anchor the post never prints. The page and the feeds should agree on one rule for a visible reply under a hidden parent: either show it everywhere, under a placeholder for its parent as the comment page already does, or hide it everywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The post's thread, the post's comments feed, /comments/feed/ and the reply's /comment/{id}/ page agree on whether an approved reply under a pending, spam or trashed comment is shown
- [ ] #2 If shown, the thread prints a placeholder for the hidden parent, matching the comment page, and the link from the reply's page to the thread lands on it
- [ ] #3 A test covers a reply under a pending parent and under a trashed parent on all four surfaces
<!-- AC:END -->
