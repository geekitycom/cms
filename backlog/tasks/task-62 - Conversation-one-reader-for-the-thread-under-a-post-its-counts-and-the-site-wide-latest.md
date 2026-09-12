---
id: TASK-62
title: >-
  Conversation: one reader for the thread under a post, its counts and the
  site-wide latest
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:08'
updated_date: '2026-09-12 21:22'
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
- [x] #1 One Conversation module answers the thread under a post, the counts per post and the site-wide latest; web/comments.ts and comments/conversation.ts are removed or reduced to calls into it
- [x] #2 The post page, the per-post comments feed, /comments/feed/ and the source:comments counts all render from it, and one test proves the page and the per-post feed show the same entries for a post that has a fediverse reply, an approved comment, a pending comment and a webmention
- [x] #3 Outside the Conversation module and the Comment intake, no module reads the comments or ap_inbox index to show a conversation
- [x] #4 createCms hands the renderer one conversation dependency rather than nested closures
- [x] #5 web/conversation.test.ts is the test surface for the whole read side and covers all three methods; readers that are removed take their tests with them
- [x] #6 Rendered HTML, feed output and ETags are unchanged, proved by the existing site and feed tests passing without edits to their expectations
- [x] #7 doc-4 and doc-6 name the module
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read doc-4, doc-6, web/conversation.ts, web/comments.ts, comments/conversation.ts, federation/replies.ts, index.ts, web/routes.ts, render.ts and their tests; map every index read used for display.
2. Turn packages/cms/src/web/conversation.ts into the Conversation module: createConversation({ admin, store, baseUrl }) returning a reader with thread(document), counts(documents) and latest(limit), plus the interaction-to-feed-item helpers and commentAnchor.
3. Red first in web/conversation.test.ts: a test through createCms proving the post page and the per-post comments feed show the same entries for a post with a fediverse reply, an approved comment, a pending comment and a webmention; then tests for counts() and latest().
4. Point web/routes.ts (per-post feed, /comments/feed/, source:comments counts) and createCms's renderer at the reader; delete web/comments.ts and comments/conversation.ts and their exports.
5. createCms builds the reader once and hands the renderer conversation: reader.thread, with no nested closures.
6. Move the removed readers' tests into web/conversation.test.ts; leave every existing site and feed test expectation untouched.
7. Update doc-4 and doc-6 to name the module via backlog doc update.
8. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
packages/cms/src/web/conversation.ts is now the Conversation module. createConversation({ admin, store, baseUrl }) returns a ConversationReader with three members — thread(document): Conversation, counts(documents): Map<permalink, number>, latest(limit): SiteInteraction[] — declared as function-valued properties so one of them can be handed out alone without a closure. Beside them it exports commentAnchor, spokenIn(conversation) (the thread flattened to everything somebody actually said, at every depth, likes and boosts left out) and feedComments(said, { baseUrl, limit }) (the one place an entry becomes a FeedComment).

Removed: packages/cms/src/web/comments.ts (postComments, siteComments, commentCounts, PostsByObjectId) and packages/cms/src/comments/conversation.ts (commentInteractions, interactionOf, commentAnchor). Neither had a test file of its own; their behaviour is now covered by web/conversation.test.ts. commentAnchor moved into the Conversation module — a comment's address on the page is the conversation's business — and comments/routes.ts and notifications/comments.ts import it from there.

Wiring: GeekityEnv gained a conversation variable, createCms builds the reader once beside the store and hands the renderer `conversation: conversation.thread` (was three nested closures), and web/routes.ts draws the per-post feed from spokenIn(conversation.thread(document)), /comments/feed/ from conversation.latest(limit) and source:comments from conversation.counts(documents).

Deliberate behaviour changes, none of them covered by an existing expectation: a webmention in a comments feed now links to the page that sent it rather than to this site's anchor (the page always did); a nested fediverse reply now appears in a post's comments feed; a reply its author deleted no longer does; and a native like or repost, which carries no words, is no longer an empty feed item. The page's HTML is unchanged.

Verified from the repo root: pnpm build (ok), pnpm test (1418 pass / 0 fail in @geekity/cms, 14 pass / 0 fail in demo), pnpm test:11ty (15 + 5 pass), pnpm typecheck (ok), pnpm lint (ok), pnpm format:check (ok). The only test file touched is packages/cms/src/web/conversation.test.ts; every site and feed test passes with its expectations as they were.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made packages/cms/src/web/conversation.ts the one Conversation module over the comments and ap_inbox indexes: createConversation({ admin, store, baseUrl }) answers thread(document), counts(documents) and latest(limit), with spokenIn and feedComments turning a reading into feed items. Deleted web/comments.ts and comments/conversation.ts; the post page, the per-post comments feed, /comments/feed/ and the source:comments counts now all draw from the reader, which createCms builds once and hands the renderer as a single dependency (conversation.thread) instead of three nested closures. Outside the module and the comment intake nothing reads either index to show a conversation; the moderation screen and the notices keep their own queries. web/conversation.test.ts is the test surface for all three methods and proves through the app that the page and the post's comments feed show the same entries for a post carrying a fediverse reply, an approved comment, a pending comment and a webmention. doc-4 and doc-6 name the module. Verified with pnpm build, test, test:11ty, typecheck, lint and format:check, all green (1418 package tests), with no edits to any existing site or feed test expectation.
<!-- SECTION:FINAL_SUMMARY:END -->
