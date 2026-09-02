---
id: TASK-16
title: 'Fedify integration: site actor, key pairs, WebFinger, NodeInfo'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-1
  - TASK-3
  - TASK-14
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - 'https://fedify.dev/manual/integration'
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire @fedify/fedify 2.x into Hono via @fedify/hono behind a factory that takes KV and queue implementations (decision-5). Actor dispatcher builds a Person or Service from settings. Key pairs (RSA and Ed25519) are generated on first boot and stored in SQLite. WebFinger resolves the handle. NodeInfo 2.1 reports software geekity-cms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /.well-known/webfinger?resource=acct:{handle}@{host} returns the actor link
- [ ] #2 GET on the actor URL with Accept: application/activity+json returns a Person with publicKey, inbox, outbox, followers, and icon when set
- [ ] #3 Key pairs persist across restarts
- [ ] #4 GET /.well-known/nodeinfo and the linked document return valid NodeInfo 2.1
- [ ] #5 fedify lookup from @fedify/cli against a dev server resolves the actor
<!-- AC:END -->
