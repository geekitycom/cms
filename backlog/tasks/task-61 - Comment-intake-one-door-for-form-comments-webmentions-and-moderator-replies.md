---
id: TASK-61
title: 'Comment intake: one door for form comments, webmentions and moderator replies'
status: To Do
assignee: []
created_date: '2026-09-05 13:08'
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
- [ ] #1 Every comment that enters content/_data/comments/ does so through one intake function; comments/submission.ts, webmention/receive.ts and admin/comments.ts no longer build a comment record or call the checker themselves
- [ ] #2 One verdict-to-status rule, written down in doc-6: discard stores nothing and removes a held webmention, spam marks spam, ham approves, no verdict leaves the approved-author rule for a form comment and pending for a webmention, and a re-sent webmention keeps a moderator's decision unless the fresh verdict is spam
- [ ] #3 The intake decides whether moderators are told: a new pending entry sends the pending notice once; a re-sent webmention and an auto-approved comment send nothing
- [ ] #4 The intake is tested through its own interface with an in-memory checker and the memory mail provider, covering every source and every verdict, without HTTP; the existing site-level tests for the form, the webmention endpoint and the admin reply pass unchanged
- [ ] #5 doc-6 and doc-7 describe the intake as the one door and doc-1's layout names the module
- [ ] #6 No public URL, template context, comment file format or feed output changes
<!-- AC:END -->
