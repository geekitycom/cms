---
id: TASK-324
title: >-
  Comments feeds speak the source namespace: source:inReplyTo, and a replies
  feed for every item
status: To Do
assignee: []
created_date: '2026-10-10 13:14'
labels:
  - feeds
  - comments
dependencies:
  - TASK-318
  - TASK-319
references:
  - 'https://source.scripting.com'
  - 'https://github.com/scripting/rss.chat/blob/main/server/code/worknotes.md'
  - 'https://users.rss.network/manton/comments/204.xml'
  - packages/cms/src/web/feed-rss.ts
  - packages/cms/src/web/conversation.ts
priority: low
type: feature
ordinal: 283800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dave Winer's rss.chat publishes conversations so a program can walk them from feeds alone (https://source.scripting.com, https://github.com/scripting/rss.chat/blob/main/server/code/worknotes.md, entry of 7/8/26, live example https://users.rss.network/manton/comments/204.xml). Every reply item carries `<source:inReplyTo>` holding its parent's guid. Any item with replies carries `<source:comments count="N" feedUrl="…"/>`, where count is the number of direct replies and feedUrl a feed holding only those replies. Each reply in that feed carries its own source:comments, so the tree is walkable one level at a time. Items in a feed that mixes authors carry core RSS `<source url="author feed">Name</source>`.

This site already emits source:comments on post items (web/feed-rss.ts), but its count is the whole conversation (commentCounts, web/conversation.ts) and its feedUrl the post's whole-thread feed, and comments feed items carry no source:inReplyTo.

URLs:
- `/replies/{id}/`: the RSS feed of a native comment's direct replies, by its id (its page is `/comment/{id}/`, TASK-318).
- `/replies/{key}/`: the same for a post or page, and for a webmention or fediverse reply, keyed by a short hash of its feed guid (a document has no id of its own, and slugs are not unique across posts and pages).
- `{permalink}feed/` stays the whole thread, flat, for `wfw:commentRss` and WordPress parity, and `/comments/feed/` stays the whole site.

A post item's source:comments points at its `/replies/{key}/` feed with a direct-replies count; `<comments>` and `wfw:commentRss` keep pointing at the page and the whole-thread feed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every item in every comments feed carries source:inReplyTo holding the guid its parent has in these feeds: the post's feed guid for a top-level reply, else the parent comment's guid
- [ ] #2 A native comment's guid in the comments feeds is its comment page URL (isPermaLink true), so source:inReplyTo and guid match
- [ ] #3 /replies/{id}/ and /replies/{key}/ answer RSS 2.0 feeds of exactly the direct replies of that item, newest first, each item in the same shape as the comments feeds; an item with no replies answers an empty feed, and an unknown id or key 404s
- [ ] #4 An item with replies, in any feed, carries source:comments with count equal to its direct replies and feedUrl its /replies/ feed; an item with none carries no source:comments
- [ ] #5 A post or page item's source:comments in the post feeds points at its /replies/{key}/ with a direct-replies count, while <comments> and wfw:commentRss are unchanged
- [ ] #6 An item whose author has a known feed (a webmention author's h-card or site, or a site user) carries <source url> naming it; others carry none
- [ ] #7 Walking from a post item through source:comments feeds reaches every reply in its thread exactly once, shown by a test that walks a three-level thread mixing native, webmention and fediverse replies
- [ ] #8 The CMS README feeds section documents the source namespace elements and the /replies/ URLs
<!-- AC:END -->
