---
id: TASK-182
title: Keep commenter emails out of content files (git history)
status: To Do
assignee: []
created_date: '2026-09-29 03:47'
labels:
  - privacy
  - comments
dependencies: []
references:
  - backlog/decisions/decision-9
documentation:
  - doc-6
priority: medium
type: feature
ordinal: 206800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commenter emails are stored in plain text in content/_data/comments/{slug}.json (author.email, with notify beside it). content/ is in git and is copied into Eleventy builds, so every email a commenter types is committed to the site's repository. The TASK-135 retention sweep and the Tools > Personal data erasure only change the working tree: an email removed from a comment file stays in git history until that history is rewritten, which few site owners will do. The email is private data used only by moderators, the auto-approval rule (name + email), reply notifications and the spam checker, so it does not belong in a published directory. The likely direction is to keep each comment's email in a private file under data/ (mode 0600), keyed by comment id, and leave only public fields in the content file, with retention, erasure, notifications and auto-approval reading from there. decision-9 (files are the source of truth, data/ is private) and doc-6 (Native Comments) describe the current format.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A comment submitted through the form has no email in any file under content/; the email is stored only under data/ with mode 0600
- [ ] #2 Existing comment files that carry author.email are migrated on boot: the email moves to data/, the content file no longer contains it, and the migration is idempotent
- [ ] #3 Auto-approval by name and email, reply notifications with their unsubscribe link, and the spam checker behave as before, proven by tests
- [ ] #4 The retention sweep and Tools > Personal data remove the email from its data/ location and keep the redacted marker behaviour
- [ ] #5 Deleting data/geekity.db and rebuilding restores the same emails in the index
- [ ] #6 README's personal data table and doc-6 describe where the email now lives, and say that emails committed before the change remain in git history until it is rewritten
<!-- AC:END -->
