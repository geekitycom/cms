---
id: TASK-66
title: >-
  Spike: Fedify with a stored actor id, a second inbox path and WebFinger
  aliases
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
labels:
  - federation
milestone: m-11
dependencies: []
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/federation/federation.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/scripts/fed-smoke.ts
  - 'https://fedify.dev/manual/actor'
  - 'https://fedify.dev/manual/inbox'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: spike
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14 needs three things from Fedify that its documented shape does not obviously give. Fedify derives an actor's id and the key id it signs with from the path template the actor dispatcher is registered under, so it is not clear it will serve an actor whose stored id is https://example.com/?author=2 while the dispatcher path is /author/{identifier}/, nor whether a signature whose keyId is the author URL's key verifies at a peer that knows the account by the stored id. Fedify registers one inbox path and one shared inbox path, and an HTTP signature covers the request path, so the compatibility switch's /wp-json/activitypub/1.0/ inbox routes cannot simply forward to another route. And WebFinger must list the author URL, the stored id and /@username as aliases and resolve any of them. Find out, with a throwaway CMS and the fed-smoke tooling (@fedify/cli, and a real Mastodon account if one is to hand), what Fedify allows directly, what the CMS's own middleware has to do instead (as mount.ts already does for the permalink), and what it cannot do at all. The answer decides the shape of TASK-68 and TASK-70 and is recorded, not built.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A written finding, in doc-4 or a new doc, that says for each of the three questions what Fedify does natively, what the CMS middleware must do, and what a peer (fedify lookup, and Mastodon if tried) accepted
- [ ] #2 The finding names the Fedify APIs involved (actor dispatcher, key pairs dispatcher, mapAlias or its equivalent, inbox listeners, createContext and respondWithObject) with versions
- [ ] #3 A recommendation for the inbox paths, the shared inbox path and how a stored actor id is served, that TASK-68 and TASK-70 can follow without a second investigation
- [ ] #4 Throwaway code is not merged; anything reusable is noted for the tasks that follow
<!-- AC:END -->
