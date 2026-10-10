---
id: TASK-319
title: An incoming webmention that replies to a comment threads under that comment
status: To Do
assignee: []
created_date: '2026-10-10 12:30'
labels:
  - comments
  - webmention
  - indieweb
dependencies:
  - TASK-318
references:
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/web/conversation.ts
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
priority: medium
type: feature
ordinal: 278800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every received webmention is stored with inReplyTo null (webmention/receive.ts), so a reply another site writes to one of the comments on a post lands at the top of the thread instead of under the comment it answers.

Read the source's u-in-reply-to. When it names a comment on the target post, by the comment's own page (TASK-318), by its #comment-<id> fragment, by a webmention reply's sender URL, or by a fediverse reply's url or id, store the webmention as a reply to that comment. Otherwise it stays top-level, as now. The webmention's own URL stays its sender's page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A webmention whose source has u-in-reply-to equal to a comment page, or to the post URL with #comment-<id>, threads under that comment
- [ ] #2 A webmention whose source replies to an earlier webmention reply (by its sender URL) or to a fediverse reply on the post (by its url or id) threads under that reply
- [ ] #3 A webmention whose u-in-reply-to names only the post, or a comment on a different post, or nothing, stays top-level
- [ ] #4 A webmention aimed at a comment page is accepted and lands on that comment's post
- [ ] #5 A source that is updated and sent again moves to the right parent when its u-in-reply-to changes
- [ ] #6 doc-6 Native Comments describes how a received reply is threaded
<!-- AC:END -->
