---
id: TASK-336
title: 'Every comment has one 16-hex key, and migrated comments stay out of feeds'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-10 21:49'
updated_date: '2026-10-10 23:15'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/web/guids.ts
  - packages/cms/src/comments/records.ts
  - packages/plugin-wordpress/README.md
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/feed-guids.tsv
priority: high
ordinal: 295800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen reviewing v0.29.0 for the andrewshell.org migration.

**Today.** A comment's stored id goes verbatim into every URL about it: its page /comment/{id}/ (form comments only), its replies feed /replies/{id}/ (form comments) or /replies/{hash of guid}/ (everything else), and its thread anchor #comment-{id}. Ids come in three shapes:
- a UUID for a new form comment or a webmention
- the ActivityPub activity or note URL for a fediverse reply or reaction
- for a comment imported from WordPress, its full WordPress URL, e.g. https://andrewshell.org/?p=574#comment-32

The importer chose that because core treats an id that parses as a URL as the comment's legacy feed guid (replyGuid in web/guids.ts), so that WordPress's comments-feed guids survive. The id does two jobs, and every URL built from it inherits the URL. On the andrewshell.org import that gives id="comment-https://andrewshell.org/?p=574#comment-32" anchors and pages at /comment/https%3A%2F%2Fandrewshell.org%2F%3Fp%3D574%23comment-32/.

**Andrew, 2026-10-10: one key, no exceptions, and migrated comments never reach a feed.**
- Every comment, and every item that can be replied to, has one key of 16 lowercase hex digits. It is the only thing in /comment/{key}/, /replies/{key}/ and #comment-{key}, for every source. Old WordPress #comment-N anchors are not kept.
- A post, page, webmention, fediverse reply or reaction, or reply post has key = first 16 hex digits of SHA-256 of its guid. A new form comment's key is 16 random hex digits minted at submission, its id is its key, and its page /comment/{key}/ is its guid.
- A comment imported from another system is marked migrated: true, the word a migrated post already uses (TASK-296). It keeps its origin identity, and its key is the hash of that origin: a fediverse reply or reaction's note or activity id, or a webmention's source URL. That is the key Geekity would give the same comment arriving natively. Only a comment that has no origin elsewhere (a WordPress form comment) is keyed by the hash of its old comment URL. A re-import gives the same keys.
- **No duplicates.** Today the importer drops the origin ids WordPress exported: the ActivityPub plugin's source_id (note id for a reply, activity id for a like or boost) and webmention_source_url. So the andrewshell.org import's 40 fediverse likes and boosts have no activity id, its fediverse reply keeps only the note's web URL, and 4 webmention likes and 1 repost have no source URL. If any of them reaches the site again (a resent webmention, a redelivered activity, v0.29.0's reply backfill), it becomes a second, non-migrated record: shown twice and fed as new. Every intake path must treat a matching origin as the comment it already holds.
- A migrated comment is shown on its post or page and in its thread exactly like any other, but it is left out of every feed: /comments/feed/, {permalink}feed/, /replies/{key}/, and the reply counts feeds advertise. It was published before the site came to Geekity, so a reader must never see it as new. Its old guid then never needs to survive, so there is no legacy guid field and no id doing two jobs.
- Core refuses a stored comment id that isn't 16 lowercase hex digits, naming the file and id.

Decide and record what happens to form comments already stored with UUIDs since v0.29.0. Their page is their guid, so a new key changes their comments-feed guid. Migrate them in place and accept the change, or mark them migrated.

**Review notes (2026-10-11), checked against the code:**
- Imported fediverse comments are comment records with source activitypub, but a redelivered activity or a backfilled reply lands in the inbox log (ap_inbox), which has no knowledge of comment records. So "no duplicates" is enforced where the conversation is read: gather() must drop an inbox row whose activity or note id matches a migrated comment's origin. Webmentions already match a resend by sender URL (AdminStore.listCommentsAt), so they only need the origin stored.
- The importer already keeps webmention_source_url as the comment's url (plugin-wordpress comments-import.ts urlOf); the webmention reactions without one are likely missing it in the export. For fediverse replies it keeps source_url before source_id, so the note id is lost when a web URL exists; likes and boosts keep neither.
- A native reply under a migrated comment is in the feeds, so its source:inReplyTo needs the migrated parent's guid even though the parent is in no feed. An imported WordPress form comment (no origin elsewhere) gets a /comment/{key}/ page like a native form comment, and that page is its guid; any other migrated comment's guid is its origin URL.
- Every stored id becoming 16 hex digits collapses decision-48's rule that a 16-hex segment is a key and anything else a native comment id; a new decision supersedes that part.
- Recommended fate for UUID form comments stored since v0.29.0 (AC#8): re-key in place deterministically (key = first 16 hex of SHA-256 of the old id), rewriting any reply post whose in-reply-to names the old /comment/{uuid}/ page; no redirects, since no deployed site holds any (shll.me has no comments).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every comment's stored id is a 16-hex key by the rules above; a record with any other id is refused when stored, naming the file and id
- [x] #2 Every comment is anchored as id="comment-{key}"; a form comment's page is /comment/{key}/; every replies feed is /replies/{key}/; source:comments, thread links and reply notices use these forms
- [x] #3 No URL the site prints (thread links and anchors, /comment/ pages, comments-feed links, /replies/ links) contains a percent-encoded URL
- [ ] #4 plugin-wordpress writes each imported comment with migrated: true and the hash key of its WordPress comment URL; a site imported with 0.2.0 picks this up on a re-import or in place, without a clash per comment file
- [ ] #5 plugin-wordpress keeps each comment's origin identity from the WXR (source_id, webmention_source_url) and keys fediverse and webmention comments by it; a webmention resend, a redelivered activity or a reply backfill for an imported comment matches it and adds no record
- [ ] #6 A migrated comment shows on its page and in its thread as before, replies to it still thread under it, and it appears in no feed and no advertised reply count
- [ ] #7 On the andrewshell.org import, /comments/feed/ and every {permalink}feed/ hold no imported comment, so a reader of WordPress's comments feed sees nothing new at cutover
- [x] #8 The fate of UUID-keyed form comments stored since v0.29.0 is decided and recorded
- [ ] #9 The README's comments, replies feed and theme sections, and the plugin-wordpress README, describe the key rule and migrated comments
- [ ] #10 gather() drops an inbox row (delivered or fetched) whose activity or note id is a migrated comment's origin, so a redelivery or backfill of an imported fediverse comment shows once
- [ ] #11 A native reply under a migrated comment threads under it and, in the feeds, names the migrated comment's guid in source:inReplyTo: its /comment/{key}/ page for an imported WordPress form comment, its origin URL otherwise
- [x] #12 A decision records the key rule, migrated comments and the UUID re-key, superseding decision-48's id-or-key segment rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Phase (a) of four: the core key rule (AC#1 core side, #2, #3, #8, #12). Phases (b) migrated comments out of feeds + AC#11, (c) plugin-wordpress import (AC#4, #5, #7), (d) gather() dedupe (AC#10) follow.

1. One key shape. feed-source.ts: isKey (16 lowercase hex) and repliesKey(guid) are the key rule for every item; isRepliesKey and the percent-encoding in repliesFeedPath go. guids.ts: commentPageHref(key) unencoded; replyGuid is a comment's page, a webmention's source URL, anything else's id; the legacy URL-id branch goes.
2. Records. A new comment's id is 16 random hex digits. A webmention's id is the key of its source and the post it was sent to (its identity, doc-7; the source alone collides when one page mentions two posts). writePost refuses any id that is not a key, naming the file and the id, so every writer (form, webmention, plugin putComments, moderation) is covered in one place.
3. migrateCommentKeys at boot, before the index rebuild, and in geekity rebuild: every stored id that is not a key becomes repliesKey(old id); inReplyTo naming an old id, page or anchor follows; data/comments emails are re-keyed with a crash-safe order; Markdown documents naming /comment/{old}/ or #comment-{old} are rewritten first. Idempotent: a site with only keys reads its files and writes nothing.
4. Conversation. Interaction and WithheldReply carry key: a comment record's id, else repliesKey of the entry's guid. Anchors, /replies/ hrefs, visibleReply, namedIn and the comment page all go by key. repliesTo finds the post a key is in and reads the reply with that key; the id-or-key branch goes. replyNamed returns the entry so callers take its id or key. commentIdAt becomes commentKeyAt, no decoding.
5. Admin store: a comment's key is its id, so the replies_key/keys_base columns, the baseUrl option and listCommentsByRepliesKey go (migration drops them).
6. Default theme: id=comment-{{ reply.key }}, ?reply_to={{ reply.key }}.
7. plugin-wordpress: emit the key of the WordPress comment URL as id and inReplyTo (minimal; phase (c) adds migrated/origin).
8. COMMENTS_FEED_REVISION moves (guids and replies links change).
9. Decision superseding decision-48's id-or-key segment rule.
10. TDD per criterion; pnpm build/test/typecheck/lint/format:check; curl a scratch site.

Revised in (a): step 8 dropped (the comments-feed ETag fingerprint already covers guids and replies links). Webmention key is the key of its source and post permalink, not of the source alone, because one source mentioning two posts would collide on the comments table's primary key.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase (a), core key rule (2026-10-10).

Built:
- web/feed-source.ts: isKey (16 lowercase hex) and repliesKey(guid) are the one key rule; isRepliesKey and the percent-encoding in repliesFeedPath are gone.
- web/guids.ts: commentPageHref(key) unencoded; replyGuid is a comment's /comment/{key}/ page, a webmention's source URL, anything else's id. The legacy URL-id guid branch is gone.
- comments/records.ts: a new comment's id is randomBytes(8) hex. A webmention's id is webmentionKey(source, post permalink) = repliesKey('{source} {permalink}'): the source alone collides when one page mentions two posts (the comments table's primary key is the id, so the second would take the first's index row). writePost refuses any id that is not a key, naming the comment file and the id, so the form, webmentions, moderation and plugin putComments are all covered in one place.
- migrateCommentKeys (exported, run at boot between migrateCommentEmails and rebuildCommentIndexes): every stored id that is not a key becomes repliesKey(old id); a comment's inReplyTo naming an old id, page or anchor follows; data/comments emails are re-keyed (union, comment file, new keys alone, so a stop anywhere loses nothing and the next boot finishes); Markdown files naming /comment/{old}/ or #comment-{old} are rewritten first. A site whose ids are all keys reads its files and writes nothing (tested, and on a scratch site: a restart changed no file).
- web/conversation.ts: Interaction and WithheldReply carry key. Anchors, /replies/ hrefs, visibleReply, namedIn and comment pages go by key; repliesTo finds the post a key is in and reads the reply with that key (the id-or-key branch and repliesHrefOf are gone); replyNamed returns the entry; commentIdAt is commentKeyAt and decodes nothing.
- admin/store.ts: a comment's key is its id, so the replies_key/keys_base columns (dropped by migration 26), the baseUrl option, refreshCommentKeys, commentKey and listCommentsByRepliesKey are gone.
- Default theme: id=comment-{{ reply.key }} and ?reply_to={{ reply.key }} (no urlencode). Theme README updated where it named ids.
- plugin-wordpress (minimal, so its tests pass against the refusal): id and inReplyTo are the key of the WordPress comment URL. Its README sentence updated. Phase (c) adds migrated and origin keys.

Decision (AC#8): UUID form comments and webmentions stored since v0.29.0, and URL ids written by plugin-wordpress 0.2.0, are re-keyed in place at boot to the key of the old id; no redirects. Recorded in decision-51.

Not done here: COMMENTS_FEED_REVISION was not moved, because the comments-feed fingerprint already includes every guid and replies link, so the ETags move by themselves. A fediverse note in the inbox log that answers an old /comment/{uuid}/ page is not rewritten (it is what the remote server sent); it threads under the post instead. No deployed site holds such a note (shll.me has no comments).

AC#1 stays open: the core side holds (minting, refusal, re-key), but the importer's origin keys and migrated flag are phase (c). AC#12 stays open until decision-51's body is filled.

Verification: pnpm build, pnpm -r test (cms 5386 pass, plugin-wordpress 90 pass, all packages 0 fail after the plugin legacy-guid test was removed), pnpm -r typecheck, pnpm lint, pnpm format:check all pass. Scratch site under the scratchpad (site336) served with dist/cli.js: UUID, URL-id and webmention comments re-keyed at boot, email kept under the new key, reply post in-reply-to rewritten and still threaded; page anchors, /comment/ links, reply_to links, feed guids, source:inReplyTo and source:comments feedUrl all use keys; old /comment/{uuid}/, /comment/{encoded URL}/ and /replies/{uuid}/ answer 404; a new form comment got a 16-hex id; a restart wrote nothing.
<!-- SECTION:NOTES:END -->
