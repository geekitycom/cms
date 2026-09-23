---
id: TASK-33
title: 'Redeliver becomes resend: rebuild the activity from the post file'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 17:47'
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
- [x] #1 Resend on a published post that has an activitypub.id delivers Update(Article) built from the current file with an activity id no follower has seen before
- [x] #2 Resend on a published post without an activitypub.id delivers Create(Article) and stamps the id into the file
- [x] #3 Resend on a trashed or draft post that has an activitypub.id delivers Delete with a Tombstone for that id
- [x] #4 Delivery outcomes are still recorded per follower and shown on the federation screen, and after deleting the database the screen shows the posts with no outcomes rather than failing
- [x] #5 No activity payload is stored anywhere; ap_outbound holds metadata only or is gone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all public: `DeliveryService.resend(slug)` through a real CMS in federation/delivery.test.ts (a published post with an id sends Update built from the file as it now reads under an id no follower has seen; one without an id sends Create and the id lands in the file; a draft and a trashed one send Delete of a Tombstone for the stored id; a slug nothing answers to, and a post never federated and not published, send nothing); the federation screen in admin/federation.test.ts (rows come from the index, trashed posts included, a post never federated is not one, the outcomes are still shown, and a boot over a deleted database lists the posts with no outcomes); the delivery-outcome cache and migration 12 in admin/store.test.ts; ContentStore.listFederated in content/store.test.ts; and pnpm fed:smoke over real sockets.

2. `resend(slug)` replaces `redeliver(activityId)`. It reads the post from the index — getBySlug, with the federated list as the fallback for a slug a page or a newer post stands in front of — and applies doc-4's delivery table to the state the file is in now: published with no activitypub.id is a Create, stamped first through the same `stamp` the publish path uses; published with one is an Update; a draft, a trashed or a scheduled post with one is a Delete of a Tombstone. Nothing else is a resend, and answers undefined.

3. The Update's id has to be one no follower has seen, and the publish path's is the content hash — the same edit resent twice would be the same activity and a peer is entitled to ignore it. `postUpdateActivity(context, document, revision?)` takes the revision, defaulting to the hash it uses now, and the resend passes the moment, exactly as `updateActor` already does. Same builder, same activity shape.

4. No payload is stored: `putOutboundActivity` and the JSON-LD compaction in `send` go, and what `ap_outbound` held that an outcome needs — activity type, object id, slug — becomes columns of `ap_deliveries`. Migration 12 rebuilds that table without the foreign key and with the three columns copied across the join, the way migration 11 rebuilt sessions, and then drops `ap_outbound`. `countOutboundActivities`, `listOutboundActivities`, `getOutboundActivity`, `putOutboundActivity`, `OutboundActivity` and `NewOutboundActivity` go with it; `lastDeliveryToObject(objectId)` arrives, mirroring `lastDeliveryToInbox`.

5. `ContentStore.listFederated(options?)` is the screen's row source: posts carrying an activitypub.id, drafts, scheduled posts and the trash included, newest first, one indexed scan rather than every post hydrated. `deliveryRows` takes documents rather than stored activities and joins each to `lastDeliveryToObject` and `countDeliveriesByStatus`; a post with no cached outcome is a row with no counts rather than no row, which is what a deleted database leaves. The button reads Resend, posts the slug, and `REDELIVER_PATH`/`redeliveryMessage` become `RESEND_PATH`/`resendMessage`. The relay panel reads the type off the outcome row, so `relayRow` loses its third argument.

6. fed:smoke waits on the outcome rather than on the stored activity, and gains a Resend leg: publish, let the Create land, resend the same post and assert the peer receives an Update of the same object under a different activity id.

7. Docs: doc-4 where it describes redeliver and what SQLite holds, and packages/cms/README.md at the delivery, relays, federation-screen, tunnel and route-table sections. Then pnpm build, test, typecheck, lint, format:check, test:11ty and fed:smoke from the root, and a manual pass on port 3000 over scratch directories: publish, resend from the screen, delete geekity.db, reboot, and see the posts listed with no outcomes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`DeliveryService.redeliver(activityId)` is `resend(slug)`. It reads the post from the content index and applies doc-4's delivery table to the state the file is in now: published with no `activitypub.id` is a `Create(Article)`, stamped first through the same `stamp` the publish path uses; published with one is an `Update(Article)`; a draft, a trashed post or one dated into the future is a `Delete` of a `Tombstone` for the stored id. Anything else — no post by that name, or one never announced and not published — is `undefined`, and nothing is queued to find that out.

`postUpdateActivity(context, document, revision?)` gained the revision, defaulting to the content hash it uses now; a resend passes the moment, exactly as `updateActor` already did. Same builder, same activity shape, an id no follower has seen.

No payload is stored anywhere. `send` no longer compacts the activity to JSON-LD, `putOutboundActivity` is gone, and the three columns an outcome cannot do without — `activity_type`, `object_id`, `slug` — moved onto `ap_deliveries`. Migration 12 rebuilds that table without the foreign key and with those columns copied across the join, the way migration 11 rebuilt `sessions`, then drops `ap_outbound`. `countOutboundActivities`, `listOutboundActivities`, `getOutboundActivity`, `putOutboundActivity`, `OutboundActivity` and `NewOutboundActivity` went with it; `lastDeliveryToObject(objectId)` arrived, mirroring `lastDeliveryToInbox`.

`ContentStore.listFederated(options?)` is the screen's row source: posts carrying an `activitypub.id`, drafts, scheduled posts and the trash included, newest first, one indexed scan rather than every post hydrated. `deliveryRows` takes documents and joins each to `lastDeliveryToObject` and `countDeliveriesByStatus`. `REDELIVER_PATH` and `redeliveryMessage` are `RESEND_PATH` and `resendMessage`; the form field is `slug`; the button reads Resend. `relayRow` lost its third argument, because the outcome row now carries the type. `Sandbox.open(config)` in `admin/__testing__/harness.ts` boots a CMS over directories the caller names, which is what a delete-and-boot test needs.

`fed:smoke` waits on the outcome rather than on a stored activity and gained a resend leg: the peer's inbox now listens for `Update` as well as `Create`, and the run asserts it receives `Update(Article)` of the post it already holds under an activity id no follower has seen.

## Decisions

- **The screen's rows come from the files, the outcomes from the cache, in that order.** Which posts belong on the panel is a fact about the content directory — a post carrying an `activitypub.id` is one some follower holds a copy of — and stays true however often the database is thrown away. How each landed is exactly the sort of thing a cache is allowed to forget. Doing it the other way round, which is what listing stored activities was, is what made a deleted database look like a site that had never federated.
- **A resent `Update` carries the moment, not the content hash.** The publish path's id is deterministic on purpose: the same edit delivered twice is one activity. A resend is asking for a revision the followers have already been offered to be offered again, and an activity id a peer has seen is one it is entitled to drop, so the hash is exactly the wrong thing there. `updateActor` had already reached this conclusion for the profile; the parameter is that rule spelled once.
- **`ap_outbound` is dropped rather than slimmed.** Everything that was left after the payload went — type, object, slug, created time — is a property of the activity, and every one of them is needed on the outcome row anyway to say what went where. A second table holding a copy of three columns would only be somewhere for them to disagree.
- **Migration 12's copy is an inner join.** The foreign key meant every delivery had an outbound row, so nothing is lost in practice; a row whose activity is somehow missing is dropped rather than given an invented type, because this table is a cache and is allowed to be empty.
- **`resend` refuses a post nobody has been told about and that is not published.** A `Delete` for an object no peer has ever seen is noise, and a `Create` of a draft would publish it. The two are one condition: nothing to withdraw and nothing to announce.
- **`postBySlug` falls back to `listFederated`.** `getBySlug` answers across both kinds and both states and takes the newest, which is the post nine times out of ten; the federated list is the right fallback for the tenth, because a post with no stored id is not one a resend has anything to say about anyway.
- **`FEDERATED_CLAUSE` treats an empty id as no id.** The front matter is a file somebody may have typed, and `activitypub: {id: ""}` is what a half-finished hand edit looks like; `articleObjectId` already ignores it.

## Mutation checks

Each mutation failed exactly the tests that name that behaviour:

- the resent `Update`'s id back to the content hash -> only 'gives two resends of an unchanged post two activity ids (AC #1)'.
- `stamp` dropped from the resend -> only 'sends a Create and stamps the id into the file (AC #2)'.
- the draft/trashed branch never taken -> only the two 'sends a Delete of a Tombstone' tests (AC #3).
- a post with no cached outcome left off the screen -> only 'lists the posts with no outcomes when the database has been deleted (AC #4)'.
- migration 12 copying no rows -> only 'is rebuilt into the outcome cache and then goes, payloads and all'.
- `listFederated` ignoring the id -> all five of its own tests, plus 'leaves out a post that has never been announced' and the inbox-rows test that counts how often a post is named.

## Validation

`pnpm build`, `pnpm test` (1020 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:11ty` (11 + 5) and `pnpm fed:smoke` all pass from the repo root.

## Manual pass on port 3000

`apps/demo/server.ts` over a scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in). `apps/demo/data` was never opened.

- The demo's `markdown-on-disk` carries an `activitypub.id` and had never been delivered from this database, so the very first screen showed it listed with 'Nothing recorded.' and a Resend button — the deleted-database case, unprompted. Resending with no followers flashed 'Nobody follows the site and no relay has accepted it, so the Update had nowhere to go.'
- Added Ada to `content/_data/federation/followers.json` and rebooted. Resend flashed 'Sent Update to 1 recipient: 0 sent, 1 queued, 0 failed' (the demo runs with a queue), and the row read `Update` with 0/1/0.
- **AC #5.** `sqlite3` showed no `ap_outbound` table, migration 12 in the ledger, and one `ap_deliveries` row carrying `activity_type`, `object_id` and `slug` beside the outcome, its activity id `…#update/2026-09-04T17%3A44%3A21.580Z`.
- **AC #4.** Killed the server, deleted `geekity.db`, `-wal` and `-shm`, booted again on the same directories and signed in: the followers list was back from the file, and the post was still listed with 'Nothing recorded.', em dashes for the three counts, and a working Resend — which then flashed 'Sent Update to 1 recipient'.
- **AC #3.** Trashed the post through the editor: the row stayed, read 'In the trash.' and showed the `Delete` the trashing sent. Resending it flashed 'Sent Delete to 1 recipient' and wrote a second `#delete/…` row under a new id.
- Resending a name nothing answers to flashed 'There is no post to send under that name, so nothing was sent.'
- Port 3000 was released and the scratch directories deleted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Redeliver is Resend, and it means "send this post as it now reads". `DeliveryService.redeliver(activityId)` is `resend(slug)`: it reads the post from the content index and builds the activity from the file at that moment, applying doc-4's delivery table to the state the file is in — a published post nobody has been told about is a `Create` and is stamped through the same path a publish stamps through, a published post the followers hold is an `Update` under a fresh timestamped id, and a draft, a trashed post or one dated into the future is a `Delete` of a `Tombstone` for the id their copy is filed under. `postUpdateActivity` took a revision parameter to make the last of those work: the publish path's deterministic hash id is exactly the wrong thing for a resend, because a peer is entitled to drop an activity id it has already seen.

No activity payload is stored anywhere any more. `ap_outbound` is gone in migration 12, which rebuilds `ap_deliveries` without the foreign key and with the three things an outcome cannot do without — the activity's type, its object id and the post's slug — copied onto the row beside the follower, the inbox, the status, the error and the time. That is the whole of what SQLite remembers about anything the site has sent, and it is a cache.

The federation screen's delivery panel now asks two questions of two sources, in the order that matters. Which posts belong on it comes from the content index — `ContentStore.listFederated()`, the posts carrying an `activitypub.id`, the trash included — because that is a fact about the files and stays true however often the database is thrown away. How each of them landed comes from the outcome cache, which a deleted database empties. So a site that has just deleted `data/geekity.db` sees every federated post listed with nothing recorded against it and can press Resend on any of them, where before it saw an empty panel.

Verified with 1020 package tests (0 fail), 22 of them new: a resend of a post edited on disk since it was announced delivering an `Update` built from the file as it now reads, two resends of an unchanged post getting two activity ids, a published post with no id delivering a `Create` and gaining one in its front matter, a trashed post and a drafted one each delivering a `Delete` whose `Tombstone` keeps the announced id, the outcomes recorded per follower, `undefined` for a name nothing answers to and for a draft nobody has been told about; the screen listing a trashed post, leaving out one never announced, and — the criterion this task turns on — a real second boot over the same content with `geekity.db` deleted, which lists the post with no outcomes and a working Resend; the store's outcome columns and `lastDeliveryToObject`; migration 12 over a database in the shape TASK-19 shipped, with `ap_outbound` gone afterwards; and `listFederated`'s own five. Each mutation-checked: the hash id restored, the stamp dropped, the withdrawal branch removed, a post with no outcome left off the screen, the migration copying nothing and the federated filter removed each failed exactly the tests that name that behaviour.

`pnpm fed:smoke` now sends the resend over real sockets: the Fedify peer receives `Update(Article)` of the post it already holds, under an activity id it has not seen, and the outcome cache says so. `pnpm build`, `test`, `typecheck`, `lint`, `format:check` and `test:11ty` all pass. Then a manual pass on a real server on port 3000 over scratch directories: a resend with no followers, one with a follower recorded and rendered, `sqlite3` confirming no `ap_outbound` and the outcome row carrying the activity's own columns, the database deleted and the post still listed with 'Nothing recorded.' and a Resend that worked, and a trashed post resending as a `Delete`.
<!-- SECTION:FINAL_SUMMARY:END -->
