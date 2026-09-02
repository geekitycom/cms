---
id: TASK-19
title: 'Deliver Create, Update, and Delete for posts to followers'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-17
  - TASK-18
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subscribe to sync events (task-4) so that a post becoming published sends Create(Article), a change to a published post sends Update(Article), and unpublishing, trashing, or deleting sends Delete with a Tombstone. Record the ActivityStreams id and first-published time in the activitypub front-matter block so re-publishing does not duplicate. Track delivery outcomes per follower and expose a redeliver function.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Publishing a post from the admin delivers Create(Article) to every follower inbox (shared inbox preferred)
- [ ] #2 Editing a published post file directly on disk delivers Update(Article)
- [ ] #3 Setting draft: true on a published post delivers Delete with a Tombstone
- [ ] #4 After first delivery the post file contains activitypub.id and activitypub.published
- [ ] #5 Restoring a trashed post that was previously federated reuses the same object id
- [ ] #6 Delivery outcomes are stored per follower and a redeliver call resends a given activity
<!-- AC:END -->
