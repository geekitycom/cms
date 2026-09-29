---
id: TASK-169
title: 'Like, repost and bookmark posts'
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - content
  - theme
  - indieweb
milestone: m-25
dependencies:
  - TASK-164
references:
  - 'https://ptd.spec.indieweb.org/'
  - 'https://indieweb.org/like'
  - 'https://indieweb.org/repost'
  - 'https://indieweb.org/bookmark'
priority: low
type: feature
ordinal: 193800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Micropub clients commonly send like-of, repost-of and bookmark-of, which the site has no post types for yet. Add them to front matter, Post Type Discovery (like and repost in spec order; bookmark is an IndieWeb extension that falls through to note/article in the spec, so record where it sits), the default theme (u-like-of, u-repost-of, u-bookmark-of as h-cite), webmentions to the target, and federation (Like and Announce activities for likes and reposts of fediverse objects, and a note linking the page otherwise; record the choice as a decision). Then accept them over Micropub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with like-of, repost-of or bookmark-of renders the matching mf2 markup citing its target, and sends it a webmention
- [ ] #2 Post Type Discovery types them in spec order, proven by tests
- [ ] #3 How each federates is recorded as a decision and implemented
- [ ] #4 The admin editor can set each of them
- [ ] #5 Micropub create accepts like-of, repost-of and bookmark-of, and q=config lists them
<!-- AC:END -->
