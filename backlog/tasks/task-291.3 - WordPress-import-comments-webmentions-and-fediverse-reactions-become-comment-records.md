---
id: TASK-291.3
title: >-
  WordPress import: comments, webmentions and fediverse reactions become comment
  records
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
updated_date: '2026-10-08 11:55'
labels: []
milestone: m-31
dependencies: []
parent_task_id: TASK-291
ordinal: 250800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site that ran the ActivityPub and Webmention plugins holds its likes, reposts, replies, mentions, bookmarks and pingbacks as wp_comments rows with plugin meta. Each becomes a Geekity comment record on the same post, so the reaction counts and conversations a reader saw under WordPress are still there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each approved comment is written to content/_data/comments/{slug}.json in the CommentRecord shape, and a commenter email, when present, only to data/comments/{slug}.json
- [ ] #2 comment_type like, repost, comment, mention, bookmark, pingback and webmention map to the matching Geekity kind and source, keeping the remote URL and author
- [ ] #3 Threaded replies keep their parent
- [ ] #4 Spam and trash are not imported; pending comments import as pending
- [ ] #5 A post's reaction counts on the Geekity site equal those WordPress showed, in a test over a fixture export
- [ ] #6 An imported comment keeps the id WordPress published in its comments feed (https://<site>/?p=ID#comment-N), so a comments-feed reader sees no imported reply as new
- [ ] #7 Imported comments are never left pending, so no moderation digest email lists them
- [ ] #8 A rerun merges by WordPress comment id into a post's comment file: new WordPress comments are added, already-imported ones are left alone, and comments the Geekity site received itself after going live are never touched or reordered
<!-- AC:END -->
