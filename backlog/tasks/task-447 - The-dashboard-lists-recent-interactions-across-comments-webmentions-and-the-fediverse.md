---
id: TASK-447
title: >-
  The dashboard lists recent interactions across comments, webmentions and the
  fediverse
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - dashboard
  - comments
  - federation
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 384800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the old Recent posts space with what people did: one list, newest first, of comments, webmentions, fediverse replies, likes and boosts, and new followers, each linking to where the owner acts on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The widget lists the ten newest interactions across comments, webmentions, fediverse replies, likes, boosts and new followers, newest first
- [ ] #2 Each entry names who, what kind, which post, and when, and links to the comment, the post or the follower
- [ ] #3 Pending comments are marked as waiting, and spam or rejected ones are left out
- [ ] #4 A site with no interactions shows a short empty state
<!-- AC:END -->
