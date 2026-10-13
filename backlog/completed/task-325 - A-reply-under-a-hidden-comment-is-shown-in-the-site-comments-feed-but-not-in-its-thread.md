---
id: TASK-325
title: >-
  A reply under a hidden comment is shown in the site comments feed but not in
  its thread
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 13:39'
updated_date: '2026-10-10 14:09'
labels:
  - comments
  - feeds
dependencies: []
references:
  - packages/cms/src/web/conversation.ts
priority: medium
type: bug
ordinal: 284800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-318. When a comment is pending, spam or trashed, an approved reply under it is dropped from the post's thread and from the post's own comments feed (threadOf in web/conversation.ts walks from visible parents only), but conversation.latest() still lists it in /comments/feed/. Since TASK-318 it also has a page at /comment/{id}/ whose link to the whole conversation points at an anchor the post never prints. The page and the feeds should agree on one rule for a visible reply under a hidden parent: either show it everywhere, under a placeholder for its parent as the comment page already does, or hide it everywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The post's thread, the post's comments feed, /comments/feed/ and the reply's /comment/{id}/ page agree on whether an approved reply under a pending, spam or trashed comment is shown
- [x] #2 If shown, the thread prints a placeholder for the hidden parent, matching the comment page, and the link from the reply's page to the thread lands on it
- [x] #3 A test covers a reply under a pending parent and under a trashed parent on all four surfaces
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Shape: a WithheldReply { id, withheld: true, replies } stands in the thread for a native comment a reader may not see (pending, spam, or deleted and so unknown) when a visible reply sits under it; Interaction.replies becomes ThreadReply[] = Interaction | WithheldReply.
2. gather() reads every stored comment for the post once and keeps the hidden ones in Gathered.held, replacing TASK-319's optional native list; replyNamed searches written plus held.
3. threadOf() hangs a visible reply under a placeholder for a held parent, or for an unknown parent of a native reply (deleted), placing the placeholder by the same rule (its own parent, else the post); placeholders exist only on demand, so one with no visible descendant prints nothing. Withdrawn fediverse notes keep moving their answers up.
4. sortThread orders a placeholder by its earliest visible reply; countReplies and spokenIn skip placeholders, so counts and feeds carry visible replies only.
5. partials/comment.njk prints a placeholder li with id comment-{id}, no author or words, the same wording as layouts/comment.njk (one macro), and its children.
6. Tests in comment-page.test.ts: replies under a pending and a deleted parent on the thread, the post feed, /comments/feed/ and the comment page; counts; no empty placeholder.
7. Theme README and doc-6 describe the placeholder; record a Backlog decision.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Chose to show (decision-46, the orchestrator's call for the operator). web/conversation.ts: a WithheldReply { id, withheld: true, replies } (ThreadReply = Interaction | WithheldReply; Interaction.replies and Conversation.replies are ThreadReply[]) stands in the thread for a pending, spam or deleted native comment that has a visible reply under it. gather() now reads every stored comment once and keeps the hidden ones in Gathered.held (TASK-319's optional native list is gone; replyNamed searches written plus held). threadOf() places a reply under a placeholder for a held parent, or for an unknown parent of a native reply (deleted); a placeholder goes where the hidden comment's own inReplyTo says, or under the post for a deleted one, and exists only on demand, so a hidden comment with no visible descendant prints nothing. Withdrawn fediverse notes keep the old move-up rule. sortThread orders a placeholder by its first visible reply; countReplies and spokenIn skip placeholders. ancestorsOf reads Gathered.held instead of the admin store. partials/comment.njk prints li.comment.comment-placeholder with the anchor and a withheld() macro that layouts/comment.njk now uses too, so the wording is one string. The li is not .comment-withheld because that class is italic in style.css and would italicise the replies under it.
Validation: comment-page.test.ts gains 12 tests (pending, spam and deleted parents on the thread, the reply page's thread link, both comments feeds, counts on the page and source:comments, a placeholder on the comment page of the comment the hidden one answers, no empty placeholder); pnpm build, pnpm test (5229 cms tests pass), typecheck, lint and format:check all pass. Curled a scratch site (scratchpad/site325): thread shows placeholders for held, spam, trashed and a held reply under an approved comment, Eve's lonely pending reply prints nothing, '5 replies' and source:comments count=5, both feeds list the 4 visible replies, never a placeholder.
Not ported: packages/cms/docs/eleventy.config.example.js still drops these replies; it had already drifted (TASK-318 comment page URLs).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An approved reply under a pending, spam or deleted comment is now shown on all four surfaces: the post's thread prints a placeholder for the hidden parent (its #comment-{id} anchor, no author or words, the comment page's wording from one shared macro) with the visible replies under it; the post's comments feed and /comments/feed/ list the reply and never the placeholder; the reply's /comment/{id}/ page links to an anchor the thread now prints; counts are visible replies only. A hidden comment with no visible reply prints nothing. Recorded as decision-46; doc-6, the CMS README and the theme README describe it. Verified by 12 new tests in comment-page.test.ts, the full pnpm build/test/typecheck/lint/format:check, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
