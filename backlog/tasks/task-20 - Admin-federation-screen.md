---
id: TASK-20
title: Admin federation screen
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
  - federation
milestone: m-2
dependencies:
  - TASK-18
  - TASK-10
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/admin/federation shows the actor handle and profile summary, the follower list with avatars and follow dates, recent inbox activity from ap_inbox, and per-post delivery status with a Redeliver button.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Followers appear with name, handle, and follow date
- [ ] #2 Recent likes, boosts, and replies are listed with links to the remote objects
- [ ] #3 Redeliver on a post re-sends its latest activity and shows the result
<!-- AC:END -->
