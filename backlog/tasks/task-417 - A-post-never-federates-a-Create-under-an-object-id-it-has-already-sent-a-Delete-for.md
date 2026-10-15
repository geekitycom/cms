---
id: TASK-417
title: >-
  A post never federates a Create under an object id it has already sent a
  Delete for
status: To Do
assignee: []
created_date: '2026-10-15 12:27'
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
- [ ] #1 A post that was Deleted and is published again, at the same permalink, federates a Create under an object id never Deleted before; a test proves it
- [ ] #2 An edit that moves a post to a permalink it had before federates under an object id never Deleted before; a test proves it
- [ ] #3 Fetching the post's page URL as ActivityPub answers with the current object id, and a reply, like or announce of any id the post has had reaches the post; tests prove both
- [ ] #4 A post that was never Deleted keeps its permalink as its object id
- [ ] #5 docs/federation.md explains why a returning post gets a new object id
<!-- AC:END -->
