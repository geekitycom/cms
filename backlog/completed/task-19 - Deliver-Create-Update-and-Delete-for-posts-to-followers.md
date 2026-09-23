---
id: TASK-19
title: 'Deliver Create, Update, and Delete for posts to followers'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 22:00'
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
- [x] #1 Publishing a post from the admin delivers Create(Article) to every follower inbox (shared inbox preferred)
- [x] #2 Editing a published post file directly on disk delivers Update(Article)
- [x] #3 Setting draft: true on a published post delivers Delete with a Tombstone
- [x] #4 After first delivery the post file contains activitypub.id and activitypub.published
- [x] #5 Restoring a trashed post that was previously federated reuses the same object id
- [x] #6 Delivery outcomes are stored per follower and a redeliver call resends a given activity
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Close the gap that stops an admin save from reaching the sync events at all: the admin write path calls store.upsert directly and the watcher then finds a matching hash, so `published`/`change` never fire for an admin publish. Add ChangeOrigin 'admin', give ContentSync an `announce(change)` that runs the same emit path, make the emitter await async listeners, put the announcer on the Hono env, and call it from saveFromForm and moveDocument.
2. Resolve object ids through the stored `activitypub.id`: articleObjectId(context, document) prefers document.activitypub.id over ctx.getObjectUri, and the object dispatcher falls back to a scan for the post whose stored id matches when the slug no longer answers, so /ap/posts/{old-slug} keeps resolving after a rename.
3. Add updateActivityId and deleteActivityId to paths.ts and postUpdateActivity/postDeleteActivity (Delete of a Tombstone with formerType Article) to article.ts; loosen postArticle and friends from RequestContext to Context so delivery outside a request can build them.
4. Admin store migration 7: ap_activities (activity_id, activity_type, object_id, slug, created_at, json) and ap_deliveries (activity_id, actor_id, inbox_id, status, error, attempted_at) with the store methods TASK-20 needs.
5. New src/federation/delivery.ts: createDeliveryService subscribes to `change`, skips origin 'scan', maps created/published to Create, a change to a still-published post to Update, and unpublish/trash/delete to Delete(Tombstone). It stamps activitypub.id and activitypub.published into the file through saveDocument before the first Create so the watcher's re-read is a hash no-op, delivers per shared-inbox group with ctx.sendActivity so each follower gets an outcome row, and exposes redeliver(activityId) rebuilt from the stored JSON-LD plus settled() for tests and shutdown.
6. Wire it into createCms as cms.delivery, re-export through federation/index.ts and index.ts.
7. Tests in src/federation/delivery.test.ts over a stubbed remote host: admin publish sends Create, a disk edit under a real watcher sends Update, save-draft sends Delete with a Tombstone, the file gains the activitypub block, a trash+restore round trip reuses the id, deliveries are recorded per follower and redeliver resends, and a boot scan delivers nothing.
8. Run build, test, typecheck, lint and format:check from the repo root and boot apps/demo once.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What landed

**A gap that had to close first.** The admin write path (`saveFromForm`, `moveDocument`, the dashboard's quick draft) writes the file and corrects the index in the same request, so the watcher's later re-read finds a matching hash and emits nothing: no sync event has ever fired for an admin save, which means `onPublish` never ran for one either. `ChangeOrigin` gains `admin`, `ContentSync` gains `announce(change)`, the emitter now awaits an `async` listener (so `ContentEventListener` returns `unknown`), and the announcer is on the Hono env as `c.var.announce`. The two config hooks stay fire-and-forget — `subscribe()` in index.ts still swallows their promise — so only a listener registered straight on `cms.events` is waited for.

**Object ids.** `articleObjectId(context, document)` prefers `document.activitypub.id` over `ctx.getObjectUri`, and `federatedObject(store, slug, baseUrl)` backs the object dispatcher: the slug lookup first, then a walk of the published posts for the one holding that id. That is what keeps `/ap/posts/{old-slug}` answering after a rename, and it is a walk rather than an index lookup because the front matter is the source of truth (decision-1) and the content index has no column for it. Only reached when the slug itself does not answer.

**A rename is an Update, not Delete + Create.** Because the stamped id follows the post through a rename, `before` and `after` resolve to the same object id and the change is an `Update`. The Delete-then-Create branch survives for the one case that can still produce two ids — a post federated before this version and renamed since — but the tests exercise the Update path, which is what doc-4's "a rename does not create a duplicate object" asks for.

**Activity ids.** `#create` (unchanged), `#update/{first 16 of the content hash}` and `#delete/{ISO instant}`. The update id is content-addressed on purpose: the sync only reports an update when the hash has moved, so it is unique per real edit and idempotent when the same activity is redelivered. Reverting a post to a body it held before would reuse an id; that is the known trade.

**Stamping.** The first activity about a post writes `activitypub.id` and `activitypub.published` through `saveDocument`, which upserts the index in the same breath — so the watcher's re-read of that file is a hash no-op and the write announces nothing of its own. It is awaited inside `handle`, which the emitter awaits, which `announce` awaits, so the admin's redirect never races the editor into a stale hash. It also rewrites the file through `serializeDocument`, which canonicalises the front matter — the same thing an admin save already does. A site with no followers still gets stamped: the id is what the outbox serves, not only what was delivered.

**Delivery.** Fedify's `sendActivity` answers `void`, so it cannot say which follower failed. Followers are grouped by the inbox one POST reaches (`groupByInbox`: shared inbox when published, personal otherwise) and each group is sent with `preferSharedInbox: true` and `orderingKey: objectId`; the group's outcome is written against every follower behind it. Deliveries run on a chain rather than in parallel so a Create cannot overtake its Update. `synchronous` is `config.federation.queue === null`, which is the difference between a `sent` row and a `queued` one.

## Verification

`pnpm build`, `pnpm test` (567 + 10 demo, all passing), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass from the repo root. `apps/demo` booted on port 3199 with the default `InProcessMessageQueue`: health and `/ap/actor` answered, nothing threw, and the boot scan federated and stamped nothing, so the demo's content directory is untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The delivery service in `src/federation/delivery.ts` subscribes to the content index and federates what changes: a post that becomes published sends `Create(Article)`, an edit to a published one sends `Update(Article)`, and drafting, trashing or deleting it sends `Delete` of a `Tombstone`. A full scan — the boot scan included — federates nothing, so a rebuilt index does not announce the archive twice. The first activity about a post writes `activitypub.id` and `activitypub.published` into its front matter through `saveDocument`, which corrects the index in the same breath so the watcher's re-read of that file is a no-op; the stored id then follows the post through a rename or a restore, and `federatedObject` resolves it so `/ap/posts/{old-slug}` keeps answering.

Because Fedify's `sendActivity` answers `void`, followers are grouped by the inbox one POST reaches — shared where they publish one — and each group's outcome is written against every follower behind it, into the new `ap_outbound` and `ap_deliveries` tables (admin migration 7). `cms.delivery.redeliver(activityId)` rebuilds the stored JSON-LD and sends it again.

Closing a gap this needed: the admin's write path corrects the index itself, so the watcher never emitted anything for an admin save and no subscriber — including a site's `onPublish` — ever heard about one. `ChangeOrigin` gains `admin`, the sync gains `announce(change)`, and the admin's save, trash, restore and quick-draft routes announce what they wrote.

Verified with 11 new tests in `src/federation/delivery.test.ts` over a stubbed remote host (admin publish delivers a Create to the shared inbox; a disk edit under a real watcher delivers an Update; save-draft delivers a Delete of a Tombstone that keeps the object id; the file gains the activitypub block; a trash-and-restore round trip reuses it; per-follower rows record sent and failed outcomes and redeliver resends; a rename stays one object) and 5 in `src/admin/store.test.ts` for the two new tables. `pnpm build`, `pnpm test` (567 package + 10 demo), `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all pass, and `apps/demo` boots clean on the default in-process queue.
<!-- SECTION:FINAL_SUMMARY:END -->
