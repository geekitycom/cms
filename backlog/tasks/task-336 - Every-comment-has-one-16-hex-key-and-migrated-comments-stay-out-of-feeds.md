---
id: TASK-336
title: 'Every comment has one 16-hex key, and migrated comments stay out of feeds'
status: To Do
assignee: []
created_date: '2026-10-10 21:49'
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
Seen reviewing v0.29.0 for the andrewshell.org migration. Folds in what was TASK-337.

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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every comment's stored id is a 16-hex key by the rules above; a record with any other id is refused when stored, naming the file and id
- [ ] #2 Every comment is anchored as id="comment-{key}"; a form comment's page is /comment/{key}/; every replies feed is /replies/{key}/; source:comments, thread links and reply notices use these forms
- [ ] #3 No URL the site prints (thread links and anchors, /comment/ pages, comments-feed links, /replies/ links) contains a percent-encoded URL
- [ ] #4 plugin-wordpress writes each imported comment with migrated: true and the hash key of its WordPress comment URL; a site imported with 0.2.0 picks this up on a re-import or in place, without a clash per comment file
- [ ] #9 plugin-wordpress keeps each comment's origin identity from the WXR (source_id, webmention_source_url) and keys fediverse and webmention comments by it; a webmention resend, a redelivered activity or a reply backfill for an imported comment matches it and adds no record
- [ ] #5 A migrated comment shows on its page and in its thread as before, replies to it still thread under it, and it appears in no feed and no advertised reply count
- [ ] #6 On the andrewshell.org import, /comments/feed/ and every {permalink}feed/ hold no imported comment, so a reader of WordPress's comments feed sees nothing new at cutover
- [ ] #7 The fate of UUID-keyed form comments stored since v0.29.0 is decided and recorded
- [ ] #8 The README's comments, replies feed and theme sections, and the plugin-wordpress README, describe the key rule and migrated comments
<!-- AC:END -->
