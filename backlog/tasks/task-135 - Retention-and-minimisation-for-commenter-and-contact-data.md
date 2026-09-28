---
id: TASK-135
title: Retention and minimisation for commenter and contact data
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - privacy
  - comments
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/data-minimization/'
priority: medium
type: feature
ordinal: 159800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commenter email addresses are stored in plain text in the comment records inside the content files (src/comments/records.ts), and nothing is ever purged. Contact-form messages are also kept forever. Only a salted IP hash is stored, which is good. A site owner should be able to collect less, and keep what they collect only as long as they need it, without editing files by hand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site can configure how long commenter emails, IP hashes and contact messages are kept, with conservative defaults documented
- [ ] #2 A scheduled job removes or redacts data past its retention period from the content files and the cache, and is idempotent
- [ ] #3 Removing a commenter's email does not break the comment thread, its moderation history, or its display
- [ ] #4 An admin can erase one commenter's personal data on request, from the admin
- [ ] #5 README lists every piece of personal data the CMS stores and where
<!-- AC:END -->
