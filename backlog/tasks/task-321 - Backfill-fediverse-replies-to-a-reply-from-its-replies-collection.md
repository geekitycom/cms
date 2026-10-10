---
id: TASK-321
title: Backfill fediverse replies to a reply from its replies collection
status: To Do
assignee: []
created_date: '2026-10-10 12:31'
labels:
  - federation
  - comments
dependencies:
  - TASK-300
references:
  - packages/cms/src/federation/replies.ts
priority: low
type: feature
ordinal: 280800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A fediverse user who answers a fediverse reply on one of our threads addresses the person they answer, not us, so their reply never reaches our inbox. Most servers publish a Note's replies as a replies collection. Fetching that collection for the fediverse replies in a thread would bring those answers in. It is polling, so it needs limits on when, how often and how deep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The site fetches the replies collection of fediverse replies in a thread and shows replies found there threaded under them, with their remote URLs
- [ ] #2 Fetching is bounded: a fetch interval per thread, a depth limit, a page limit, and no fetch for threads older than a set age
- [ ] #3 A reply already held from the inbox is not shown twice, and a reply the remote server drops is removed
- [ ] #4 A server that does not publish replies, or answers with an error, is skipped without breaking the thread
- [ ] #5 The CMS README Federation section describes the backfill and its limits
<!-- AC:END -->
