---
id: TASK-62
title: >-
  Conversation: one reader for the thread under a post, its counts and the
  site-wide latest
status: To Do
assignee: []
created_date: '2026-09-05 13:08'
labels:
  - web
  - federation
milestone: m-9
dependencies:
  - TASK-61
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/web/comments.ts
  - packages/cms/src/comments/conversation.ts
  - packages/cms/src/federation/replies.ts
  - packages/cms/src/index.ts
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-6 - Native-Comments.md
type: task
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The thread under a post and the comments feeds merge the same two indexes (comments and ap_inbox) with two implementations. postConversation in web/conversation.ts builds the page's thread and counts; web/comments.ts builds postComments, siteComments and commentCounts for the feeds; comments/conversation.ts adapts native comments for the first. They share only replyFrom and sanitizeCommentHtml, and createCms reaches the page's reader through three nested closures. doc-4 already calls this the conversation on the page. Make it one Conversation module with three methods: the thread under a post, the counts for a set of posts, and the site's latest replies paged. The renderer, the per-post and site-wide comments feeds and the source:comments counts all call it, and nothing outside it reads the comments or ap_inbox index to show a conversation. Fediverse replies stay unmoderated with their status of published; a moderated entry reaches a reader only when approved. The moderation screen and the notices are not conversation display and keep their own queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One Conversation module answers the thread under a post, the counts per post and the site-wide latest; web/comments.ts and comments/conversation.ts are removed or reduced to calls into it
- [ ] #2 The post page, the per-post comments feed, /comments/feed/ and the source:comments counts all render from it, and one test proves the page and the per-post feed show the same entries for a post that has a fediverse reply, an approved comment, a pending comment and a webmention
- [ ] #3 Outside the Conversation module and the Comment intake, no module reads the comments or ap_inbox index to show a conversation
- [ ] #4 createCms hands the renderer one conversation dependency rather than nested closures
- [ ] #5 web/conversation.test.ts is the test surface for the whole read side and covers all three methods; readers that are removed take their tests with them
- [ ] #6 Rendered HTML, feed output and ETags are unchanged, proved by the existing site and feed tests passing without edits to their expectations
- [ ] #7 doc-4 and doc-6 name the module
<!-- AC:END -->
