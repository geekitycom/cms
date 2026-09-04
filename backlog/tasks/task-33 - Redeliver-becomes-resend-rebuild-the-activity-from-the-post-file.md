---
id: TASK-33
title: 'Redeliver becomes resend: rebuild the activity from the post file'
status: To Do
assignee: []
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 00:19'
labels:
  - federation
  - admin
milestone: m-4
dependencies:
  - TASK-19
  - TASK-20
  - TASK-32
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: task
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace stored activity payloads with resend-current-state (decision-9). `DeliveryService.redeliver(activityId)` becomes `resend(slug)` (or by object id), which reads the post file and sends `Create(Article)` when it carries no `activitypub.id` (stamping it), `Update(Article)` with a fresh timestamped activity id when it is published, and `Delete` with a `Tombstone` when it is a draft or in the trash. The `ap_outbound` payload column goes away; what remains is a delivery-outcome cache in SQLite (activity id, type, object id, slug, follower, inbox, status, error, time) that is allowed to be empty after a database rebuild. The federation screen's per-post rows come from the content index (posts with an `activitypub.id`, including trashed ones) joined to the latest cached outcome, and the button reads Resend. The outbox collection stays derived from the index and is untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resend on a published post that has an activitypub.id delivers Update(Article) built from the current file with an activity id no follower has seen before
- [ ] #2 Resend on a published post without an activitypub.id delivers Create(Article) and stamps the id into the file
- [ ] #3 Resend on a trashed or draft post that has an activitypub.id delivers Delete with a Tombstone for that id
- [ ] #4 Delivery outcomes are still recorded per follower and shown on the federation screen, and after deleting the database the screen shows the posts with no outcomes rather than failing
- [ ] #5 No activity payload is stored anywhere; ap_outbound holds metadata only or is gone
<!-- AC:END -->
