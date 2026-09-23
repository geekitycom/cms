---
id: TASK-18
title: 'Inbox: Follow, Undo Follow, actor Delete; followers collection; inbox log'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 21:35'
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
- [x] #1 A Follow from a test actor results in a stored follower and an Accept sent to the follower inbox
- [x] #2 Undo(Follow) removes the follower
- [x] #3 The followers collection lists stored followers with a total count
- [x] #4 Like, Announce, and reply activities are stored in ap_inbox with actor, type, object, and received time
- [x] #5 Requests with invalid HTTP signatures are rejected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: add admin migrations 5 (followers) and 6 (ap_inbox) plus typed AdminStore methods — putFollower/getFollower/deleteFollower/listFollowers/countFollowers and logInboxActivity/listInboxActivities/countInboxActivities. Red first in src/admin/store.test.ts.
2. Config: add a `federation` block to GeekityConfig/ResolvedConfig (kv, queue, allowPrivateAddress) so decision-5's 'stores swapped by configuration' is real and a test can boot a synchronous, private-address-allowing CMS. createSiteFederation learns `queue: null` meaning no queue (inline inbox and delivery); the default stays InProcessMessageQueue.
3. src/federation/followers.ts: FOLLOWERS_PAGE_SIZE, followerRecipient(follower) -> Recipient, followersPage(context, cursor) -> PageItems<Recipient>. Wire setFollowersDispatcher with setCounter/setFirstCursor/setLastCursor exactly like the outbox.
4. src/federation/inbox.ts: handleFollow (verify the Follow object is the site actor, store the follower, reply Accept to the follower's inbox), handleUndo (Undo of a Follow by the same actor removes the follower), handleDelete (an actor deleting itself removes the follower), and logInboxActivity for Like/Announce/Create/everything handled. Register them on setInboxListeners in federation.ts.
5. Tests in src/federation/inbox.test.ts: a remote actor with its own RSA key pair, globalThis.fetch stubbed to serve the remote actor document and to capture POSTs to its inbox, requests signed with Fedify's signRequest. Cover Follow -> stored + Accept, repeat Follow is idempotent, Undo(Follow) removes, Delete removes, Like/Announce/Create(Note) logged, unsigned and wrongly signed Follows rejected and not stored, followers collection pages with totalItems.
6. Re-export the new names through src/federation/index.ts and src/index.ts; quiet LogTape in the test helper if it starts printing.
7. Run pnpm build, test, typecheck, lint, format:check from the repo root.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Store (packages/cms/src/admin/store.ts): migration 5 adds `followers` (actor_id primary key, inbox_id, shared_inbox_id, handle, name, icon_url, url, followed_at) and migration 6 adds `ap_inbox` (id, activity_id with a unique index, activity_type, actor_id, object_id, received_at, json). New AdminStore methods: countFollowers, listFollowers({limit, offset}), getFollower, putFollower (upsert on actor_id that keeps the original followed_at, so a repeat Follow is not a second follower), deleteFollower, countInboxActivities, listInboxActivities, logInboxActivity (upsert on activity_id, so a redelivered Like stays one row; a NULL activity id is always its own row).

Config: GeekityConfig/ResolvedConfig gained a `federation` block (FederationOverrides: kv, queue, allowPrivateAddress) and createSiteFederation now extends it. `queue: null` means no queue at all — an inbound activity is handled and any reply delivered inside the request that carried it — which is what makes the inbox testable end to end; the default is unchanged (InProcessMessageQueue). This is decision-5's 'the stores can be swapped by configuration' made real, and TASK-19's delivery tests will want the same switch. Documented in packages/cms/README.md under a new Federation section.

New src/federation/followers.ts: FOLLOWERS_PAGE_SIZE = 20, followerRecipient (a Follower row as Fedify's Recipient, with endpoints.sharedInbox), followersPage and lastFollowersCursor. A null cursor means 'the whole collection', because that is what Fedify's getFollowers asks for before fanning an activity out; answering it with one page would have silently stranded every follower past the twentieth. A string cursor is a decimal offset, exactly like the outbox.

New src/federation/inbox.ts: handleFollow (parseUri checks the object really is the site actor, stores the follower off the dereferenced actor document, replies Accept with a fresh random id to the follower's own inbox), handleUndo (only the actor that sent the Follow may undo it), handleDelete (only a Delete whose object is its own actor removes a follower), handleLoggedActivity, and logActivity (every handled activity is logged, follow traffic included; the type name comes from getTypeId rather than the class name or the JSON).

Verification: 16 new tests in src/federation/inbox.test.ts stand up a remote actor with its own RSA key pair, stub globalThis.fetch to serve that actor document and capture POSTs to its inbox, and sign deliveries with Fedify's signRequest. 5 new tests in src/federation/federation.test.ts cover the followers collection and the one-shot delivery list; 16 new tests in src/admin/store.test.ts cover the two tables.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired the ActivityPub inbox, the followers collection and the inbound activity log.

A Follow whose object is the site actor stores the follower — actor id, inbox, shared inbox, handle, name, icon and profile URL — and replies Accept to that follower's inbox. Undo(Follow) removes the follower when the actor undoing it is the one that sent it; a Delete whose object is its own actor does the same. Like, Announce and Create are recorded in a new ap_inbox table and acted on no further, and the follow traffic is recorded alongside them so the log is the whole story. The followers collection is served from SQLite with a total count and offset cursors; following stays empty. Followers, the log and the actor keys all live in SQLite, so nothing a site cannot regenerate depends on Fedify's in-memory stores.

Two admin migrations (5: followers, 6: ap_inbox) and their typed AdminStore methods; a new src/federation/followers.ts and src/federation/inbox.ts; and a new `federation` config block (kv, queue, allowPrivateAddress) that makes decision-5's swappable stores real — `queue: null` handles and delivers inline, which is what lets a test observe the inbox.

Verified with 37 new tests. src/federation/inbox.test.ts stands up a remote actor with its own RSA key pair, routes globalThis.fetch to serve its actor document and capture deliveries to its inbox, and signs each delivery with Fedify's signRequest: a Follow is stored and answered with an Accept carrying the Follow's id (AC1), an Undo removes it (AC2), Like, Announce and a Create(Note) reply land in ap_inbox with actor, type, object and arrival time (AC4), and an unsigned Follow, one signed by a key the actor does not own, and one naming an unpublished key are all refused with nothing stored (AC5). src/federation/federation.test.ts walks the followers collection across a page boundary and checks its totalItems (AC3). pnpm build, test (551 + 10 passing), typecheck, lint and format:check all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
