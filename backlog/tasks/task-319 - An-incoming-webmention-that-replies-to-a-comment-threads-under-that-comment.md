---
id: TASK-319
title: An incoming webmention that replies to a comment threads under that comment
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:30'
updated_date: '2026-10-10 13:53'
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
- [x] #1 A webmention whose source has u-in-reply-to equal to a comment page, or to the post URL with #comment-<id>, threads under that comment
- [x] #2 A webmention whose source replies to an earlier webmention reply (by its sender URL) or to a fediverse reply on the post (by its url or id) threads under that reply
- [x] #3 A webmention whose u-in-reply-to names only the post, or a comment on a different post, or nothing, stays top-level
- [x] #4 A webmention aimed at a comment page is accepted and lands on that comment's post
- [x] #5 A source that is updated and sent again moves to the right parent when its u-in-reply-to changes
- [x] #6 doc-6 Native Comments describes how a received reply is threaded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. microformats.ts: SourceEntry gains inReplyTo, every u-in-reply-to URL of the chosen entry (a nested h-cite by its url).
2. conversation.ts: commentIdAt(pathname), the inverse of commentPageHref. ConversationReader gains replyNamed(document, url): the id of the reply on that post a URL names, by comment page, post#comment-<id>, a webmention's sender URL, or a fediverse reply's url or id. It searches gather()'s written list built over every stored comment of the post whatever its status, so the parent is a fact and visibility stays a read-time question.
3. receive.ts: checkWebmentionRequest takes the reader and resolves a /comment/{id}/ target to that comment's post (AC#4). verifyWebmention stores inReplyTo as the first in-reply-to the reader resolves, and a source that answers a reply on this post is a reply.
4. records.ts: a re-sent webmention's update moves inReplyTo (AC#5).
5. Wire the reader through the webmention service, routes and pingback.
6. Tests first in webmention/receive.test.ts for AC#1-5; doc-6 section on received replies (AC#6).
7. pnpm build/test/typecheck/lint/format:check; curl a scratch site with a webmention to a comment page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SourceEntry (webmention/microformats.ts) gains inReplyTo: every in-reply-to of the chosen entry, a nested h-cite by its url.

ConversationReader gains replyNamed(document, url) -> id | undefined (web/conversation.ts). It runs gather() over every stored comment on the post whatever its status (gather now takes the native list as an optional third argument, approved ones by default) and finds the written reply a URL names: commentIdAt(pathname) for /comment/{id}/ (percent-decoded), {permalink}#comment-{id}, a reply's url made absolute (webmention sender page, fediverse note url, native comment page) or a reply's id (fediverse note id). Pending and spam comments are candidates on purpose: the parent is a fact, visibility is read-time (TASK-325 territory).

verifyWebmention stores inReplyTo as the first in-reply-to replyNamed resolves, and a source that answers a reply on this post is kind reply even when it never names the post. intakeComment's rewrite of a held webmention now carries inReplyTo (updateComment accepts it), so a re-sent source moves.

checkWebmentionRequest takes conversation: Pick<ConversationReader,'comment'> and resolves a /comment/{id}/ target to that approved native comment's post, then applies documentAt (served check) to the post's permalink. Wired through routes.ts, pingback.ts, service.ts (new required conversation option) and index.ts.

Docs: doc-6 'Where a received reply goes (TASK-319)', replyNamed in the reader list, and a line under 'A comment's own page'; doc-7 'On the page'; packages/cms README webmention section.

Verification: 8 new tests in webmention/receive.test.ts (AC1-5), failing before the change (400 for comment-page targets, inReplyTo null). Mutations checked: dropping the kind override fails the sender-URL test; dropping inReplyTo from the rewrite fails the AC#5 test. pnpm build, pnpm --filter @geekity/cms test (5217 pass), typecheck, lint, format:check all pass; two full-workspace test runs each had one different timing-flaky failure (migrated-site, micropub token) that passes alone and on a rerun. Scratch site: POST /_geekity/webmention with target /comment/{uuid}/ -> 202, a percent-encoded WordPress URL id -> 202, /comment/nope/ -> 400.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Received webmentions now thread under the reply they answer. The source's u-in-reply-to is resolved by the new ConversationReader.replyNamed against every reply on the target post (comment page, #comment- anchor, earlier webmention sender URL, fediverse note url or id); unresolved stays top-level; a re-sent source moves parent. A webmention aimed at /comment/{id}/ is accepted and lands on that comment's post (webmention and pingback endpoints). Verified with 8 new receive tests plus mutation checks, the full build/test/typecheck/lint/format suite, and curl against a scratch site (202 for comment pages, 400 for an unknown one). doc-6, doc-7 and the README describe it.
<!-- SECTION:FINAL_SUMMARY:END -->
