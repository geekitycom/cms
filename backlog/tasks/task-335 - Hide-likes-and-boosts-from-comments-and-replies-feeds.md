---
id: TASK-335
title: Hide likes and boosts from comments and replies feeds
status: To Do
assignee: []
created_date: '2026-10-10 21:34'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/feed-guids.tsv
priority: medium
ordinal: 294800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Andrew, 2026-10-10: likes and boosts are reactions, not comments. They belong on the page, not in a feed someone reads for conversation.

Today every approved comment record is a feed item, whatever its kind. Since v0.29.0 there are three kinds of feed that carry them: /comments/feed/, each document's {permalink}feed/, and the /replies/{key}/ feeds that source:comments links point at. So a post with 30 boosts is a comments feed of 30 boosts.

Seen on the andrewshell.org migration. The cutover side of it is now TASK-336's: imported comments are migrated and stay out of every feed, so imported reactions can't reach one. This task is the general rule for reactions that arrive on Geekity itself. For the record: Prod's /comments/feed/ (WordPress with the ActivityPub plugin) lists only replies and mentions: 7 mentions and 3 replies in the 2026-10-08 baseline (asdo_geekity _local/snapshot/baseline/feed-guids.tsv, comments_feed.xml). Geekity's newest 10 are 9 likes and boosts on posts 1130 and 813, plus one of prod's mentions. At cutover a comments-feed subscriber would see 9 items WordPress never published. The behaviour is the same on v0.28.0.

Rule: a feed of comments or replies carries only conversational records, replies and mentions. Likes, boosts and reposts are left out of every such feed and every reply count a feed advertises. A webmention repost is the IndieWeb form of a boost. Reactions stay on the page and in the comment data exactly as now.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /comments/feed/, every {permalink}feed/ and every /replies/{key}/ feed list replies and mentions only; likes, boosts and reposts are left out
- [ ] #2 The reply counts the feeds advertise (source:comments, slash:comments) count only what those feeds list, and an item whose only responses are reactions advertises no replies feed
- [ ] #3 Reactions still show on the post or page, with their counts, exactly as before
- [ ] #5 The README's feeds and replies feed sections say which comment kinds a feed carries
<!-- AC:END -->
