---
id: TASK-207
title: 'Pinned posts: the ActivityPub featured collection'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:51'
labels:
  - federation
  - admin
  - theme
dependencies: []
references:
  - packages/cms/src/federation/actor.ts
  - packages/cms/src/admin/documents.ts
priority: low
type: feature
ordinal: 223800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mastodon shows an account's pinned posts at the top of its profile, read from the actor's featured collection (toot:featured). Let a user pin up to a handful of their published posts from the post editor (a pinned flag in front matter, so it lives in the file), publish the actor's featured collection as an OrderedCollection of those posts' objects, and send the Add/Remove activities Mastodon expects when a pin changes. The default theme may also show pinned posts first on the author archive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user can pin and unpin a published post from the editor, stored as front matter
- [x] #2 The actor document links a featured collection listing the user's pinned posts in order
- [x] #3 Pinning and unpinning federate Add and Remove to followers, and a pinned post that is deleted or unpublished drops out
- [x] #4 A Mastodon instance shows the pinned posts on the profile, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a pin is front matter `pinned: <ISO instant>` (absent = not pinned), kept in Document.extra like lang/comments so it lives in the file (decision-9). One module, content/pinned.ts, owns the key, the reader pinnedAt(document) (Date or string from YAML, `true` from a hand edit reads as the post's date), and PINNED_POST_LIMIT = 5 (Mastodon's).
2. Index: ContentStore.listPinnedByAuthor(names) returns the user's published posts carrying a pin, most recently pinned first, capped at the limit.
3. Editor (AC1): a Pinned checkbox on posts. Ticking it writes the current instant, keeping an existing one through later saves; clearing it removes the key. Pinning a sixth post for the same author is refused with a 400 and nothing written.
4. Federation (AC2): a featured dispatcher at /author/{username}/featured/ serving an OrderedCollection of the pinned posts' objects (postObject), and the actor's `featured` pointing at it.
5. Delivery (AC3): DeliveryService.handle compares the pin before and after a change on federated posts: newly pinned (or a published post that arrives pinned) sends Add {object: post id, target: featured URL} after the Create/Update; unpinned sends Remove. A post that stops being federated sends only its Delete: the collection drops it, and Mastodon drops a pin with the status it deletes.
6. Tests first for each AC (posts editor tests, a featured.test.ts for the actor and collection, delivery.test.ts for Add/Remove), then the code. Verify with build/test/typecheck/lint/format and curl a running site on a spare port.
7. AC4: no Mastodon instance is reachable from here, so check the collection and the Add/Remove shapes against Mastodon's FetchFeaturedCollectionService and Add/Remove handlers and record it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- Shape: front matter `pinned: <UTC instant>`, the moment it was pinned, kept in Document.extra like lang and comments, so pin and order both live in the file (decision-9). content/pinned.ts owns the key, the reader pinnedAt() (Date or string from YAML; a hand-written `pinned: true` reads as the post's date) and the limit. Unticking removes the key rather than writing false; a later save keeps the original instant.
- Cap: 5 per user, Mastodon's own. The editor refuses a sixth new pin for the same author with a 400 and writes nothing; an already pinned post saves freely. A hand-edited sixth pin is not refused anywhere, so the collection itself keeps only the 5 most recent pins (ContentStore.listPinnedByAuthor applies featuredPosts()).
- Order: most recently pinned first, Mastodon's behaviour for its own featured collection.
- Unpublished, trashed or deleted pinned post: drops out of the collection at once, because listPinnedByAuthor reads the same published archive as listByAuthor. No Remove is federated. The Delete already goes out, and Mastodon destroys a deleted status's StatusPin with it. The pinned key stays in the file, so republishing the post pins it again and sends Create then Add.
- Federation: FEATURED_PATH /author/{username}/featured/ through Fedify's setFeaturedDispatcher, plus a counter. The actor's featured points at it. Add and Remove carry object = the post id (stored activitypub.id honoured via articleObjectId), target = the featured URL, to Public, cc followers. Ids are {object}#pin/{pinnedAt} and {object}#unpin/{now}. They go after the post's own Create or Update, in the delivery queue's order. Add is sent only when the post is in the collection now, so a pin past the cap is never announced.
- Items are bare ids, not embedded objects. Mastodon's FetchFeaturedCollectionService skips an embedded item unless its type is Note, and every titled post here is an Article. Fedify types featured items as Object but serialises a URL item as the bare id (filterCollectionItems in middleware). The cast in federation.ts depends on that, and featured.test.ts asserts the bare-id shape so a Fedify change fails the test.

AC #4: no Mastodon instance was reachable. A local site on localhost cannot be fetched by a real instance, so nothing was shown on a real profile. What was checked against Mastodon main (raw GitHub, 2026-10-01):
- app/services/activitypub/fetch_featured_collection_service.rb reads orderedItems from an OrderedCollection, accepts String items, requires each item's host to match the account URI's host (it does: posts and actor share the site origin) and fetches each status. Embedded non-Note items are skipped, which is why the items are bare ids.
- app/lib/activitypub/activity/add.rb and remove.rb act when value_or_id(target) == account.featured_collection_url, which is the actor's featured value. Our target is that exact URL. Add fetches the status by object id when unknown and requires status.account_id to be the sender. Remove destroys the StatusPin.
- Mastodon orders pinned_statuses by status_pins.created_at desc. Pins created live from Add follow pin time. On a first collection sync it creates pins in collection order, so the newest pin gets the oldest created_at. That reverses order on first sync for any server, Mastodon's own included, and is not ours to fix.
- curl against a running site on port 3917 (stopped by PID): GET /author/ada/ as application/activity+json had featured: http://localhost:3917/author/ada/featured/. GET of that URL returned 200 application/activity+json {type: OrderedCollection, totalItems: 2, orderedItems: [/newer-pin/, /older-pin/]}. The unpinned post was absent.

Not done: the description's optional theme change (pinned posts first on the author archive). It is not an acceptance criterion.

Validation: pnpm build, pnpm test (3050 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts can be pinned from the editor with a Pinned checkbox. It writes `pinned: <instant>` into the front matter, keeps that instant through later saves, removes the key on unpin, and refuses a sixth pin per author. Each actor now links a featured collection at /author/{username}/featured/. It is an OrderedCollection of the bare ids of that user's published pinned posts, most recently pinned first, at most 5. Pinning a published post sends Add (target = featured URL) after its Create or Update. Unpinning sends Remove. A pinned post that is unpublished or deleted sends only its Delete and drops out of the collection. Verified with new tests in admin/posts.test.ts, federation/featured.test.ts and federation/delivery.test.ts, all of which failed before the code, plus the full build, test, typecheck, lint and format gates, and curl of the actor and collection on a running site. The Mastodon criterion was checked against Mastodon's source, not a live instance. The notes record exactly what was checked.
<!-- SECTION:FINAL_SUMMARY:END -->
