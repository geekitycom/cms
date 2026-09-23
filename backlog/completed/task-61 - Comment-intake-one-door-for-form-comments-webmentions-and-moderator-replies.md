---
id: TASK-61
title: 'Comment intake: one door for form comments, webmentions and moderator replies'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:08'
updated_date: '2026-09-12 21:03'
labels:
  - web
  - admin
  - content
milestone: m-9
dependencies: []
references:
  - packages/cms/src/comments/submission.ts
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/comments/records.ts
  - packages/cms/src/admin/comments.ts
  - packages/cms/src/comments/moderate.ts
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
  - backlog/docs/doc-7 - Webmentions.md
type: task
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Native comments (TASK-50), webmentions (TASK-51) and a moderator's reply on the admin comments screen are three writers of the same comment file (doc-6). Each builds its own comment record; two of them wrap the CommentChecker in their own ask function (comments/submission.ts and webmention/receive.ts); and they map a verdict to a status by rules that already differ: a form comment takes ham as approved, while a re-sent webmention keeps the moderator's decision and moves only on spam. The pending notice to moderators is sent from two call sites under two different conditions. Deepen comments/records.ts into a Comment intake: one function that is handed a proposed comment and its source and owns everything between that and a comment existing: the approved-author rule, the checker call, the verdict-to-status rule, the file and index write inside the per-file lock, and the pending notice on a new entry. Form parsing, the cheap defences in forms/protection.ts and the throttle, webmention fetching and verification, and the admin screen stay where they are and become callers that hand the intake a proposed comment. Out of scope: fediverse replies (published by design, in the inbox log, doc-4), the contact form (it asks the checker but stores a message, not a comment), and moving the read queries (TASK-62).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every comment that enters content/_data/comments/ does so through one intake function; comments/submission.ts, webmention/receive.ts and admin/comments.ts no longer build a comment record or call the checker themselves
- [x] #2 One verdict-to-status rule, written down in doc-6: discard stores nothing and removes a held webmention, spam marks spam, ham approves, no verdict leaves the approved-author rule for a form comment and pending for a webmention, and a re-sent webmention keeps a moderator's decision unless the fresh verdict is spam
- [x] #3 The intake decides whether moderators are told: a new pending entry sends the pending notice once; a re-sent webmention and an auto-approved comment send nothing
- [x] #4 The intake is tested through its own interface with an in-memory checker and the memory mail provider, covering every source and every verdict, without HTTP; the existing site-level tests for the form, the webmention endpoint and the admin reply pass unchanged
- [x] #5 doc-6 and doc-7 describe the intake as the one door and doc-1's layout names the module
- [x] #6 No public URL, template context, comment file format or feed output changes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read doc-6, doc-7, doc-1 and every module in References plus their tests; confirm the seam under test is intakeComment's own interface (records.ts), with the existing site-level tests for the form, the webmention endpoint and the admin reply as the unchanged outer seam.
2. Red: new tests in packages/cms/src/comments/records.test.ts driving intakeComment directly — an in-memory CommentChecker, a real CommentNotifier over createMemoryMailProvider, an AdminStore and a content dir, no HTTP. Cover every origin (form, webmention, moderator) against every verdict (spam, discard, ham, unknown), the approved-author rule, the re-sent webmention rule and the three notice cases.
3. Green: add intakeComment to comments/records.ts. It owns: hashing the address, the approved-author rule, the CommentChecker call (and treating a thrown checker as no opinion), the one verdict-to-status rule, finding the webmention a source already has here, the file and index write inside the per-file lock (addComment/updateComment/deleteComment), and the notices.
4. Make comments/submission.ts a caller: parse, defend, throttle, build a proposed comment, hand it over. No record building, no ask(), no status mapping.
5. Make webmention/receive.ts a caller: fetch, verify, read microformats, hand over a proposed comment. Drop its ask() and its held/update/delete status rules.
6. Make admin/comments.ts reply a caller with origin 'moderator'.
7. Move the pending notice off comments/routes.ts and webmention/service.ts into the intake; keep replyApproved for moderation in notifications/routes.ts and the admin moderate action.
8. Update doc-6 (the verdict-to-status table and the one door), doc-7 (where it lands) and doc-1's layout via backlog doc update.
9. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as intakeComment in packages/cms/src/comments/records.ts:

  intakeComment(options: IntakeCommentOptions): Promise<CommentIntakeOutcome>

where IntakeCommentOptions is { records, origin: 'form' | 'webmention' | 'moderator', comment: ProposedComment, post?, dataDir, baseUrl, checker?, notices?, address?, userAgent?, referrer?, logger? } and CommentIntakeOutcome is { kind: 'stored', comment, created } | { kind: 'discarded', removed } | { kind: 'gone' }. ProposedComment is Omit<PostComment, 'id' | 'status' | 'addressHash'> — the three things the intake decides. heldWebmention(records, slug, source) is exported alongside it so a source's identity is read in one place.

It owns: hashing the address, the site's own status (approved-author rule for a form comment, pending for a webmention, approved for a moderator), the CommentChecker call (skipped entirely for a moderator; a thrown checker is 'unknown' and logged), the verdict-to-status rule, the add/update/delete inside the per-file lock, and the notices.

Callers are now thin. comments/submission.ts parses, defends, throttles and hands over a proposed comment; its ask() and status mapping are gone. webmention/receive.ts fetches, verifies and reads microformats, then hands over; its ask(), storedFrom() and update/add status rules are gone, and it keeps only the delete of a source that stopped linking. admin/comments.ts reply hands over with origin 'moderator'. comments/routes.ts and webmention/service.ts no longer call notifications.pending or replyApproved — routes passes notices: c.var.notifications into submitComment, service passes it into verifyWebmention.

Tests: 16 new cases in packages/cms/src/comments/records.test.ts under 'the comment intake', driving intakeComment with a remembering in-memory CommentChecker and a real CommentNotifier over createMemoryMailProvider (plus an AdminStore, a ContentStore and a temp content dir). No HTTP. Every origin against every verdict, the approved-author rule, the re-sent webmention rules, the discard-removes-held rule and the three notice cases.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deepened packages/cms/src/comments/records.ts into the one door every comment enters by: intakeComment(options) now owns the address hash, the approved-author rule, the CommentChecker call, one verdict-to-status rule, the file and index write inside the per-file lock, and the decision about who is told. comments/submission.ts, webmention/receive.ts and admin/comments.ts hand it a ProposedComment and keep only what is really theirs (form parsing and the cheap defences, fetching and verifying a source, knowing who is signed in); comments/routes.ts and webmention/service.ts no longer send notices themselves.

Verified with 16 new node:test cases in comments/records.test.ts that drive intakeComment directly with an in-memory CommentChecker and a CommentNotifier over createMemoryMailProvider — every origin against every verdict, the re-sent webmention rules and the three notice cases — and with the untouched site-level tests for the comment form, the webmention endpoint, Akismet and the admin reply. From the repo root: pnpm build, pnpm test (1412 + 14 passing, 0 failing), pnpm typecheck, pnpm lint and pnpm format:check all exit 0. doc-6 gains a 'One door in' section with the verdict-to-status table and the who-is-told rule, doc-7's 'Where it lands' says the endpoint proposes rather than writes, and doc-1's repository layout names comments/records.ts and webmention/.
<!-- SECTION:FINAL_SUMMARY:END -->
