---
id: TASK-327
title: 'A /replies/{key}/ request finds its item without scanning the whole site'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 15:07'
updated_date: '2026-10-10 16:54'
labels:
  - feeds
  - performance
dependencies:
  - TASK-324
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/web/routes.ts
priority: low
type: enhancement
ordinal: 286800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-324 (decision-48) resolves /replies/{key}/, where key is the first 16 hex digits of sha256 of an item's feed guid, by scanning every served document, stored comment, logged fediverse reply and reply post per request. The URL is public, so anyone can make the site do that scan as often as they like with made-up keys, and the cost grows with the site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Resolving a /replies/{key}/ looks the key up in an index rather than scanning documents and reply records
- [x] #2 The index stays correct as documents, comments, webmentions, fediverse replies and reply posts are added, edited, moved or removed, and after a restart
- [x] #3 An unknown key answers 404 without touching more than the index
- [x] #4 A test shows the lookup still finds a post, a page, a native comment by key, a webmention, a fediverse note and a reply post
- [x] #5 /replies/ serves nothing for a document that does not show its conversation (a page without comments: true, or comments off site-wide): it 404s like {permalink}feed/ does, using the same answerable rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the guid rules the feeds and the index share into web/guids.ts: postObjectId and feedGuid (from web/documents.ts; feedGuid now the guid a document has while served, with no clock), commentPageHref / COMMENT_PAGE_PREFIX and replyGuid (from web/conversation.ts). It imports only negotiate.ts, so both stores can use it without a cycle.
2. Content index: migration 10 adds documents.replies_key (key of feedGuid), documents.reply_post_key (key of postObjectId, for a post with in-reply-to) and documents.keys_base, with indexes. upsert writes them; openContentStore({ baseUrl }) recomputes rows whose keys_base differs (new column, or a changed site URL). New listByRepliesKey(key).
3. Admin store: migration 23 adds comments.replies_key + keys_base (refreshed the same way on open with baseUrl) and ap_inbox.reply_key (key of the note id, base-free, backfilled by the migration's run). putComment/replaceComments/logInboxActivity/replaceInboxActivities write them. New listCommentsByRepliesKey(key), listRepliesByKey(key).
4. index.ts and cli.ts pass config.baseUrl to both stores.
5. conversation.repliesTo reads the three indexed lookups instead of scanning; delete keyedReplies.
6. routes repliesFeed 404s when showsConversation is false (AC#5).
7. Tests: store tests for add/edit/move/remove/restart/base change; conversation test that a lookup never calls listAll/listComments/listReplies/listReplyPosts; replies-feeds test for a native comment by key, /about/ with comments: true, and a page without it 404ing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Index lives next to the rows it names. Content index migration 10: documents.replies_key (key of feedGuid), documents.reply_post_key (key of postObjectId, reply posts only; differs only with a stored guid), documents.keys_base. Admin migration 23: comments.replies_key + keys_base, ap_inbox.reply_key (note id key, base-free, backfilled by the migration's run via federation/replies.ts replyIdOf). Keys are written by every upsert/putComment/replaceComments/logInboxActivity/replaceInboxActivities, so add/edit/move/remove and the decision-9 rebuilds keep them right. Keys of documents and native comments depend on the base URL, so both stores take an optional baseUrl at open and recompute every row whose keys_base differs (new column, or a changed site URL); index.ts openCache and cli.ts pass config.baseUrl. A store opened without one writes NULL keys, filled on the next open with a base.

The guid rules moved to web/guids.ts (postObjectId and feedGuid from web/documents.ts, commentPageHref, COMMENT_PAGE_PREFIX and replyGuid, formerly guidOf, from web/conversation.ts) so the stores can share them without importing a module that imports a store. feedGuid no longer consults the clock: it is the guid a document has while served, which is the only time a feed carries it; for an unserved post with a stored activitypub.id it now answers that id instead of the permalink, which no feed shows.

conversation.repliesTo asks store.listByRepliesKey, admin.listCommentsByRepliesKey and admin.listRepliesByKey in turn; keyedReplies is gone. routes repliesFeed 404s when showsConversation(c, found.post) is false (AC#5).

Verification: pnpm build, pnpm test (cms 5302 pass, all workspaces green, no flakes), typecheck, lint, format:check. New tests: content/store.test.ts and admin/store.test.ts 'the /replies/ keys (TASK-327)' (post, page, edited guid, stored object id, move, draft, remove, reply post by object id, restart, base change, unkeyed rows, migration backfill of ap_inbox, comment delete and replaceComments, rebuilt inbox log); web/conversation.test.ts proves a lookup and an unknown key never call listAll/listPosts/listReplyPosts/listComments/listReplies (it fails if listAll is called); web/replies-feeds.test.ts adds a native comment by key and the /colophon/ page without comments: true 404ing by key, by comment id and by comment key, with /about/ now comments: true (the AC#5 test fails with the route check removed). Scratch site under scratchpad/site327 curled: post, comment by id and by key, about page 200; colophon by key/id/comment key and its feed/ 404; unknown key 404; a live edit adding guid + permalink moved the key; a restart on a new base URL answered only the new base's keys.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A /replies/{key}/ request now resolves through indexed key columns on the rows that hold each item (documents, comments, ap_inbox) instead of scanning the site, and 404s for a document not showing its conversation. Keys are written with each row, recomputed on open when the base URL changes, and backfilled for logged replies. Verified with new store, conversation and feed tests, the full workspace suite, and curl against a scratch site including a live edit and a base-URL restart.
<!-- SECTION:FINAL_SUMMARY:END -->
