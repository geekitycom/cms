---
id: TASK-40
title: >-
  Relay subscriptions: follow Mastodon-style relays and deliver public
  activities to them
status: To Do
assignee: []
created_date: '2026-09-04 01:02'
labels:
  - federation
  - admin
milestone: m-5
dependencies:
  - TASK-19
  - TASK-20
  - TASK-38
references:
  - 'https://w3id.org/fep/ae0c'
  - 'https://tags.pub/'
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 27750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user distributes posts through https://tags.pub/, a hashtag relay that boosts any public post carrying a hashtag it tracks, and which the site reaches as a Mastodon-style relay (FEP-ae0c) at `https://tags.pub/user/_____relay_____/inbox`. Fedify ships the relay-server half only (`@fedify/relay`) and says it does not subscribe an application to remote relays, so the client half is ours: a `Follow` whose object is the ActivityStreams Public collection, sent to the relay's inbox; an `Accept` of that follow arriving in our inbox; and from then on every public activity delivered to that inbox as well as to the followers.

Add a `relays` setting: a list of relay inbox URLs, edited on the settings screen (one per line) and mirrored to `site.json`. For each relay the CMS keeps a subscription record (inbox URL, the relay actor id once known, state `pending` or `accepted`, the follow activity id, timestamps). Adding a relay sends the `Follow` of Public to its inbox, signed by the site actor; the inbox handler for `Accept` matches the follow id and marks the subscription accepted (a `Reject` marks it rejected with the reason shown). Removing a relay sends `Undo(Follow)` and drops the record. The delivery service adds every accepted relay inbox as one more recipient group in its fan-out, so `Create`, `Update` and `Delete` for posts (and the actor `Update` from TASK-28) reach relays and are recorded per relay in the delivery outcomes like a follower would be; resend covers them too. The `Article` already carries a `Hashtag` per tag and per category, which is what tags.pub keys on.

The federation screen gains a Relays panel: each relay with its state, when it was accepted, its last delivery outcome, and a Retry that re-sends the `Follow` for one stuck in pending. Announces the relay sends back (a hashtag account boosting a post) already land in the inbox log and appear as boosts. Relay records are operational state and may live in the same SQLite index tables TASK-32 rebuilds, with the relay list itself in `site.json` as the source; a boot with an accepted relay in the file and no record re-sends the `Follow`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Adding a relay inbox URL on the settings screen stores it, mirrors it to site.json, and sends a signed Follow of the Public collection to that inbox, proved by a stubbed relay that records the request
- [ ] #2 An Accept of that Follow arriving in the inbox marks the relay accepted; a Reject marks it rejected with the reason shown on the federation screen
- [ ] #3 Publishing, editing or withdrawing a post delivers the Create, Update or Delete to every accepted relay inbox as well as to the followers, with a delivery outcome recorded per relay, and a pending or rejected relay receives nothing
- [ ] #4 Removing a relay sends Undo(Follow) to it and stops deliveries to it
- [ ] #5 The federation screen lists each relay with its state and last outcome and offers Retry for a pending one
- [ ] #6 Resend on a post reaches accepted relays too
<!-- AC:END -->
