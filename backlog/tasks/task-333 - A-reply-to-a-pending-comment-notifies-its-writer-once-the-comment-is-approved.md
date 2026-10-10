---
id: TASK-333
title: A reply to a pending comment notifies its writer once the comment is approved
status: To Do
assignee: []
created_date: '2026-10-10 19:36'
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
- [ ] #1 A reply post answering a pending comment sends the reply notice when that comment is approved, if its writer asked for one
- [ ] #2 The notice is still sent at most once per comment and reply post (the reply-notice ledger), across edits, restarts and a second approval
- [ ] #3 A comment approved with no reply post under it sends nothing
<!-- AC:END -->
