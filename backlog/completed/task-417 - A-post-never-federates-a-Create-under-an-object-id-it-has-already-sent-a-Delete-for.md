---
id: TASK-417
title: >-
  A post never federates a Create under an object id it has already sent a
  Delete for
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 12:27'
updated_date: '2026-10-15 13:24'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/federation/delivery-plan.ts
  - packages/cms/src/federation/article.ts
  - packages/cms/src/federation/paths.ts
priority: high
type: bug
ordinal: 372800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mastodon records a permanent Tombstone for every Delete it receives (app/lib/activitypub/activity/delete.rb: Tombstone.find_or_create_by), and it also holds a delete-upon-arrival marker for a while. After that it rejects any Create, and any URL search, for that object id (create.rb tombstone_exists? / delete_arrived_first?). The CMS uses the post's permalink as its object id and sends a Delete when a post becomes a draft, is trashed or deleted, or when an edit changes its object id (revisionStep 'replace' in packages/cms/src/federation/delivery-plan.ts: withdraw, then announce). If a post later federates again under an id that was Deleted, for example after it is republished or after an edit moves its URL away and back, every Mastodon server that saw the Delete silently drops it, forever. This happened on shll.me on 2026-10-15: the Miss Peregrine read post never reached me.dm, its URL search found nothing, and only recreating it at a new slug worked. Fix it so a Create or a re-announce never reuses an object id the site has Deleted. Proposed: record withdrawn object ids, and federate a returning post under a fresh object id (the permalink plus a revision query or fragment) while its url stays the page. Make sure inbound replies, likes and the conversation map the new id back to the document, and that fetching the page URL with an ActivityPub Accept answers with the current id.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post that was Deleted and is published again, at the same permalink, federates a Create under an object id never Deleted before; a test proves it
- [x] #2 An edit that moves a post to a permalink it had before federates under an object id never Deleted before; a test proves it
- [x] #3 Fetching the post's page URL as ActivityPub answers with the current object id, and a reply, like or announce of any id the post has had reaches the post; tests prove both
- [x] #4 A post that was never Deleted keeps its permalink as its object id
- [x] #5 docs/federation.md explains why a returning post gets a new object id
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New record content/_data/federation/objectIds.json (kept with the site, in git beside followers.json and quotes.json; survives geekity rebuild because it is not in geekity.db): { deleted: [object ids a Delete went out for], reissued: { <natural id>: [<natural id>?v=2, ...] } }. Module federation/object-ids.ts: read, recordDeleted, claimObjectId (reissue when the current id is deleted), currentObjectId, objectIdsOf, naturalObjectId (strips a trailing ?v=n / &v=n).
2. The natural id stays postObjectId (permalink or stored activitypub.id), so feed guids, replies keys and front matter do not change. articleObjectId answers the current id from the record, so Create, Update, Delete, pins, outbox, featured and the page served to an ActivityStreams request all name it.
3. delivery.ts: withdraw of an object records the id once the Delete is about to reach at least one inbox (not when dev mode holds it or nobody is addressed); announce of an object claims a fresh id first when the current one was deleted. resend re-announces with a Create when the current id was deleted.
4. Inbound: postByObjectId and storedObjectAt strip the revision; the conversation gathers activities about every id the post has had and threads a reply to any of them under the post; quote stamps name the current id; the admin delivery table looks up the current id.
5. Tests first (tdd): republish after draft/trash gets ?v=2 Create (AC1, replaces the restore test that expected the old id); a hand edit that moves the permalink away and back gets a fresh id (AC2); page URL as AS answers the current id, reply/like/announce to the old and new ids reach the post (AC3); a never-deleted post keeps its permalink (AC4).
6. docs/federation.md section on reissued ids (AC5). Full verification suite and fed smoke tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design:
- Record: content/_data/federation/objectIds.json, { deleted: [ids a Delete went out for], reissued: { <natural id>: [ids since, oldest first; last is current] } }. In content/ beside followers.json and quotes.json, because the files are the truth (decision-9): it survives geekity rebuild and is exported with the site, with no data-files.ts declaration needed. Site-wide rather than per post, so a deleted file whose permalink a new post later takes is covered too.
- Not front matter: a reissued id in activitypub.id would change postObjectId, and with it the feed guid (decision-12) and the /replies/ key (decision-51). The natural id (permalink or stored activitypub.id) stays postObjectId; only the wire id (articleObjectId) reads the record. Keyed by natural id, which survives an editor move (decision-20 keeps it in activitypub.id).
- Fresh id: natural id + ?v=n (&v=n after a WordPress ?p=813), the lowest n >= count+1 never deleted. A query, not a fragment: the permalink route matches on the path only, so the id dereferences to the post and the Article it serves names the id; a fragment would collide with the #create/#update activity ids built on the object id.
- delivery.ts: withdraw records the id just before the first POST (not when dev mode holds the Delete or no inbox is addressed); announce claims a fresh id when the current one was deleted; resend sends a Create rather than an Update when the current id was deleted.
- Inbound: postByObjectId and the stored-id route strip the revision; the conversation gathers activities about every id in the record and threads a reply to any of them under the post; quote stamps name the current id; the admin delivery table looks up the current id.
Validation: pnpm build, pnpm test (cms 6223 pass), pnpm test:11ty, typecheck, lint, format:check all pass; plugin-wordpress fed:smoke and packages/cms scripts/fed-smoke.ts pass offline.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post that federates again after a Delete now does so under a fresh object id (its permalink or stored id plus ?v=n), recorded with every deleted id in content/_data/federation/objectIds.json, so Mastodon's permanent tombstone no longer swallows it. The id stays until the next Delete and is used by Updates, Deletes, pins, the outbox and the page's ActivityStreams answer; inbound replies, likes, boosts and quotes of any id the post had resolve to it. Posts never deleted keep their permalink id. Tests: delivery.test.ts (restore and republish get ?v=2/?v=3, edit away and back on disk gets ?v=2, record survives a database rebuild, never-deleted post keeps its permalink), article.test.ts (page URL and ?v=2 answer the current id, migrated ?p=813&v=2 served, outbox, postByObjectId), conversation.test.ts (replies, likes, boosts across ids). Full suite, 11ty, typecheck, lint, format and both federation smoke tests pass. docs/federation.md explains it.
<!-- SECTION:FINAL_SUMMARY:END -->
