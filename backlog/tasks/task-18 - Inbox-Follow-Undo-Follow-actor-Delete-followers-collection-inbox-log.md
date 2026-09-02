---
id: TASK-18
title: 'Inbox: Follow, Undo Follow, actor Delete; followers collection; inbox log'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-16
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Inbox listeners per doc-4. Follow stores the follower (actor id, inbox, shared inbox, display data) and replies Accept. Undo(Follow) and Delete of an actor remove the follower. Like, Announce, and Create(Note) are logged to an ap_inbox table without further action. Followers collection is served from SQLite; following is empty.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Follow from a test actor results in a stored follower and an Accept sent to the follower inbox
- [ ] #2 Undo(Follow) removes the follower
- [ ] #3 The followers collection lists stored followers with a total count
- [ ] #4 Like, Announce, and reply activities are stored in ap_inbox with actor, type, object, and received time
- [ ] #5 Requests with invalid HTTP signatures are rejected
<!-- AC:END -->
