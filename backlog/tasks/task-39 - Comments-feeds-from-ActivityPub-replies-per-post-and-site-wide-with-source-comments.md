---
id: TASK-39
title: >-
  Comments feeds from ActivityPub replies: per post and site-wide, with
  source:comments
status: To Do
assignee: []
created_date: '2026-09-04 00:51'
labels:
  - web
  - federation
milestone: m-5
dependencies:
  - TASK-37
  - TASK-18
references:
  - 'https://source.scripting.com/'
  - 'https://andrewshell.org/2026/08/meet-me-at-wordcamp/feed/'
  - 'https://andrewshell.org/comments/feed/'
type: feature
ordinal: 27250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site serves a comments feed per post at `{permalink}feed/` and a site-wide one at `/comments/feed/`, and the `source` namespace defines `<source:comments count="N" feedUrl="…"/>` as the item-level pointer to that feed. The CMS has no comments of its own, but the inbox log already stores every `Create` reply a fediverse actor sends (`inReplyTo` is the post's ActivityStreams object id), so those replies are the comments.

Serve `{permalink}feed/` as RSS 2.0 titled "Comments on: {title}" whose items are that post's replies newest first: `title` from the actor's name or handle, `link` and `guid` the reply's `url` or `id`, `dc:creator`, `pubDate` from the reply's `published` or the received time, `description` and `content:encoded` from the Note's content (sanitised HTML), plus `atom:link rel="self"`. `/comments/feed/` is the same over every post, each item also naming its post. Both honour `feedSize` and answer empty rather than 404 for a post with no replies; an unknown permalink is a 404. The trailing-slash canonical redirect covers both.

Every RSS post item then carries `<source:comments count="N" feedUrl="{permalink}feed/"/>` with the reply count, and for WordPress parity `<comments>{permalink}#comments</comments>` and `<wfw:commentRss>` (namespace `http://wellformedweb.org/CommentAPI/`) pointing at the same feed. Counting replies per post needs an indexed `in_reply_to` column on the inbox index rather than a JSON scan; TASK-32 later rebuilds that index from the inbox log files, so keep the column derived from the stored activity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post's {permalink}feed/ is RSS 2.0 titled Comments on: {title} listing that post's replies from the inbox log newest first with the elements in the description, and is empty rather than 404 when there are none
- [ ] #2 /comments/feed/ lists replies across every post newest first, each item naming its post
- [ ] #3 Every RSS post item carries source:comments with the correct count and the per-post feed URL, plus comments and wfw:commentRss for WordPress readers
- [ ] #4 A reply to a post that is later trashed or unpublished stops appearing in /comments/feed/ and its per-post feed answers 404
- [ ] #5 Reply HTML is sanitised before it enters a feed
- [ ] #6 /comments/feed and {permalink}feed redirect 301 to their slashed forms
<!-- AC:END -->
