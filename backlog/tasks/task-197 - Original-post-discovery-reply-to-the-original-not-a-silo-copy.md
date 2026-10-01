---
id: TASK-197
title: 'Original-post-discovery: reply to the original, not a silo copy'
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
labels:
  - indieweb
  - webmention
dependencies:
  - TASK-155
references:
  - packages/cms/src/webmention/reply-context.ts
  - 'https://indieweb.org/original-post-discovery'
priority: low
type: feature
ordinal: 213800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks for original-post-discovery: when someone replies to a POSSE copy of a post (a tweet, a Mastodon status), the reply should go to the original. Two halves. Sending: when a post's in-reply-to is a silo URL whose page carries a u-url/rel=canonical/original-of link back to an IndieWeb original, reply to the original and send the webmention there (keep the silo URL as an extra in-reply-to so Bridgy can thread it). Receiving: once TASK-155 records u-syndication links, a webmention or backfed response whose target is one of this site's syndicated copies is attached to the original post.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Replying to a silo copy that links to its original sends the webmention to the original and shows the original in the reply context
- [ ] #2 The silo URL stays in the post's in-reply-to so syndication to that silo can thread the reply
- [ ] #3 A response that targets one of this site's syndicated copies is shown on the original post
<!-- AC:END -->
