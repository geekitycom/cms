---
id: decision-48
title: >-
  Comments feeds are a walkable tree: direct-reply counts and /replies/ feeds
  keyed by guid
date: '2026-10-10 15:02'
status: accepted
---
## Context

rss.chat walks conversations from feeds alone. Each reply names its parent's
guid in `source:inReplyTo`. Each item with replies carries `source:comments`,
whose `count` is its direct replies and whose `feedUrl` holds only those.

Before TASK-324, `source:comments` carried a whole-thread count from the
indexes and pointed at the flat whole-thread feed, and comments-feed items
named no parent. Posts and pages have no id of their own, and slugs are not
unique across them.

## Decision

The comments feeds are one reading of `ConversationReader.thread`.

- Every visible reply has a guid. A native comment's is its page URL, except
  that an imported comment with a URL id keeps that id. Any other reply's guid
  is its own id.
- Every visible reply has a parent: the nearest visible reply above it, or the
  post. A hidden comment in between is passed over, as a withdrawn note
  already is.
- An item's direct replies are its visible children, with a hidden child's
  visible replies lifted to it.
- `/replies/{segment}/` serves an item's direct replies. A segment of exactly
  16 lowercase hex digits is a key: the first 16 hex digits of sha256 of the
  item's feed guid. Anything else is a native comment id. A native comment
  whose id reads as a key is addressed by its key.
- The post feeds' `source:comments` counts direct replies, points at the key
  feed, and is left out at zero. `{permalink}feed/` and `/comments/feed/` keep
  their meaning.
- `counts()` is read from the thread, not from the indexes.

## Consequences

- A reader can walk a thread one level at a time and reach every visible reply
  exactly once.
- The post-feed count changed meaning from all replies to direct replies, and
  a post with none carries no `source:comments`.
- Resolving a key scans the documents and the reply indexes per request, which
  is O(site). TASK-327 indexes the keys.
- `FEED_ITEM_REVISION` is 14 and `COMMENTS_FEED_REVISION` is 4, so every feed
  ETag moves once.
- In the feeds, a reply under a hidden comment reads as answering the nearest
  visible ancestor.
