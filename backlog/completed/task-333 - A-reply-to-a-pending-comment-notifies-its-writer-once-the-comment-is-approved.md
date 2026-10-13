---
id: TASK-333
title: A reply to a pending comment notifies its writer once the comment is approved
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 19:36'
updated_date: '2026-10-10 20:04'
labels:
  - comments
dependencies:
  - TASK-326
references:
  - packages/cms/src/comments/reply-notices.ts
priority: low
type: bug
ordinal: 292800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-326 sends the reply notice when a reply post answering a native comment is first served (comments/reply-notices.ts), and only when heldAt resolves the in-reply-to to a visible comment. A reply to a comment that is still pending therefore never notifies its writer, even after the comment is approved, because the reply post was already served when it became visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reply post answering a pending comment sends the reply notice when that comment is approved, if its writer asked for one
- [x] #2 The notice is still sent at most once per comment and reply post (the reply-notice ledger), across edits, restarts and a second approval
- [x] #3 A comment approved with no reply post under it sends nothing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AdminStore.putComment reads the stored status before the upsert and its ConversationWrite carries the comment id and approved: true when this write is what made it approved (deleteComment carries approved: false). A rebuild still says nothing, as a scan says nothing to the content listener.
2. web/conversation.ts exports commentNames(id, permalink, baseUrl), the URLs a reply post may name a native comment by (its page and the post's #comment- anchor); namesOf uses it.
3. comments/reply-notices.ts keeps one sending function, tell(reply), shared by handle(change) and a new heard(written): heard looks up the served reply posts (unlisted included) answering a just-approved native comment with ContentStore.listRepliesTo(commentNames(...)) and tells each through the same reply-notice ledger. Its work is SQLite reads and a queued mail send, nothing that takes the comment-file lock.
4. index.ts subscribes replyNotices.heard to admin.onConversationWrite.
5. Tests in comments/reply-post-paths.test.ts first: approve a pending comment with a reply post under it (AC1, both moderation doors), approve twice / edit / restart (AC2), approve with none (AC3).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: the reply notice had one trigger, the content change that first serves a reply post, and heldAt only resolves visible comments, so a reply post served while its comment was pending had no later moment to be news.

Fix: AdminStore.putComment reads the stored row before the upsert, and its ConversationWrite comment variant now carries id and approved (true only when this write moved the comment to approved; deleteComment says false). Every live door that approves a comment (moderation screen, the signed approve link in a message, intake auto-approval, a webmention update) goes through putComment, so the one hook covers them; a rebuild at boot says nothing, matching the scan rule on the content side. createReplyNotices gains heard(written), subscribed in index.ts to admin.onConversationWrite: for an approved native comment it reads ContentStore.listRepliesTo(commentNames(id, permalink, baseUrl)) and runs each served reply post (unlisted included) through tell(reply), the same function handle(change) now calls, so the reply-notice:{comment}:{permalink} ledger is shared by both triggers. heard only reads the indexes and queues mail, so it is safe inside the comment-file lock. web/conversation.ts exports commentNames, which namesOf now uses, so the two agree on what URLs name a comment.

Validation: five tests in comments/reply-post-paths.test.ts (describe TASK-333) failed before the fix (three with actual 0 / expected 1) and pass after: approve from the queue after a moderation-screen reply, approve from the signed link for a reply post on file naming the #comment- anchor, once across spam+approve, a Micropub edit and a restart, no second send for a reply post told at publish, and no mail at all for an approval with no reply post. pnpm build, test (cms 5380 pass), typecheck, lint and format:check all pass. No curl check: the criteria are about mail, which the tests drive through the real app with the memory mail provider.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reply post answering a pending native comment now sends its reply notice when the comment is approved. AdminStore comment writes say which comment they are and whether they approved it; reply-notices.ts listens to them and tells each served reply post answering that comment through the same once-only ledger as the publish trigger. Verified by five new end-to-end tests (fail before, pass after) and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
