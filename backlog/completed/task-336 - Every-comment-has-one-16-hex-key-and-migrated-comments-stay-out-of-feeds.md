---
id: TASK-336
title: 'Every comment has one 16-hex key, and migrated comments stay out of feeds'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 21:49'
updated_date: '2026-10-11 00:03'
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
- [x] #1 Every comment's stored id is a 16-hex key by the rules above; a record with any other id is refused when stored, naming the file and id
- [x] #2 Every comment is anchored as id="comment-{key}"; a form comment's page is /comment/{key}/; every replies feed is /replies/{key}/; source:comments, thread links and reply notices use these forms
- [x] #3 No URL the site prints (thread links and anchors, /comment/ pages, comments-feed links, /replies/ links) contains a percent-encoded URL
- [x] #4 plugin-wordpress writes each imported comment with migrated: true and the hash key of its WordPress comment URL; a site imported with 0.2.0 picks this up on a re-import or in place, without a clash per comment file
- [x] #5 plugin-wordpress keeps each comment's origin identity from the WXR (source_id, webmention_source_url) and keys fediverse and webmention comments by it; a webmention resend, a redelivered activity or a reply backfill for an imported comment matches it and adds no record
- [x] #6 A migrated comment shows on its page and in its thread as before, replies to it still thread under it, and it appears in no feed and no advertised reply count
- [x] #7 On the andrewshell.org import, /comments/feed/ and every {permalink}feed/ hold no imported comment, so a reader of WordPress's comments feed sees nothing new at cutover
- [x] #8 The fate of UUID-keyed form comments stored since v0.29.0 is decided and recorded
- [x] #9 The README's comments, replies feed and theme sections, and the plugin-wordpress README, describe the key rule and migrated comments
- [x] #10 gather() drops an inbox row (delivered or fetched) whose activity or note id is a migrated comment's origin, so a redelivery or backfill of an imported fediverse comment shows once
- [x] #11 A native reply under a migrated comment threads under it and, in the feeds, names the migrated comment's guid in source:inReplyTo: its /comment/{key}/ page for an imported WordPress form comment, its origin URL otherwise
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

Phase (b), migrated comments out of feeds (AC#6, AC#11):
1. Record shape: CommentRecord gains migrated?: true and origin?: string (absent otherwise, so existing files stay byte for byte), read and written by the comment file, the admin index (migration 27 adds two columns) and the plugin API (PluginComment.migrated, PluginComment.origin, optional), so phase (c) only has to fill them.
2. Interaction gains guid and migrated. Each constructor sets its guid, which replaces replyGuid's switch: a stored comment's is its /comment/{key}/ page when its source is comment, else its origin, else its url; an inbox reply's or reply post's is its id.
3. Feeds: feedComments, directReplies-based counts and repliesIn leave migrated entries out; the thread, the page and /comment/{key}/ do not. A native reply under a migrated entry keeps it as parent, so source:inReplyTo names its guid.
4. Simplify: replyGuid goes from guids.ts; nothing else special-cases imported ids.
5. TDD: records round trip, plugin round trip, a feeds test over migrated comments of every source; pnpm checks; curl a scratch site.

Phase (c), plugin-wordpress import (AC#1 importer side, #4, #5 except the inbox dedupe, #7):
1. Core exports the key rule to plugins: repliesKey and webmentionKey from @geekity/cms/plugin (webmentionKey moves beside repliesKey in web/feed-source.ts), so the importer derives no key itself.
2. Core PluginSite.renameComments(permalink, renames): each held comment a rename names takes its new id in place, every reply naming it follows, the index follows. Plugin commands run migrateCommentEmails and migrateCommentKeys first, as a boot does, so an import run before any boot meets only keys.
3. Importer: every comment migrated: true; origin = source_id for a fediverse comment (note id for a reply, activity id for a like or boost; url keeps the web URL), webmention_source_url (or a linkback's page, or source_id) for a webmention. Key = repliesKey(origin) for activitypub, webmentionKey(origin, permalink) for webmention, repliesKey(WordPress comment URL) with no origin. inReplyTo is the parent's key.
4. Re-import over a 0.2.0 import: per post, rename every held comment whose id is a former key of an imported comment (the re-keyed WordPress URL) to its new key; move import.json entries recorded under a former name (the URL 0.2.0 used, or the re-keyed key) to the new key, keeping the record's verdict when the held comment is still what 0.2.0 wrote; an owned comment the site edited keeps its content but gets migrated and origin.
5. README: keys, migrated, origin, anchors.
6. TDD: origin/key/migrated per source; 0.2.0 shape + boot + re-import gives one record per comment; real WXR scratch site: no imported comment in /comments/feed/ or any {permalink}feed/; real 0.2.0 import (git worktree at plugin-wordpress-v0.2.0) then boot then re-import.

Phase (d), inbox dedupe (AC#10, rest of AC#5, AC#9 core README):
1. One helper in web/conversation.ts, heldComment(admin, id): the stored comment whose origin is this fediverse id, found by its key (repliesKey(id)) and confirmed by its origin.
2. gather(): an inbox reply (delivered or fetched; compared by note id) or reaction (by activity id) that a stored comment holds is dropped; the stored record wins. A reaction folds with a migrated one by the same person (author URL). The walk is seeded with the thread's activitypub origins, and an inbox reply whose inReplyTo is a held origin threads under the stored record.
3. siteConversation drops a held inbox reply; documentNamed finds a held origin's post, so a reply to an imported note is in /comments/feed/.
4. backfill: level() reads an activitypub reply's collection by its guid (a migrated record's origin, not its key), and a note a stored comment holds is not logged.
5. Tests in federation/backfill.test.ts; README (comments, replies feed, theme) and themes/default/README.md describe keys and migrated comments.
6. pnpm checks; scratch site with the real WXR plus a redelivered Create and Like curl'd.
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

Phase (b), migrated comments out of feeds (2026-10-10).

Built:
- admin/store.ts: CommentRecord gains migrated?: true and origin?: string, absent otherwise so existing files stay byte for byte (migratedFields, the rsvpField/viaField pattern). The index carries both (migration 27 adds comments.migrated and comments.origin). comments/records.ts reads and writes both in the comment file; updateComment and a webmention resend keep them, since they spread the held entry.
- plugin.ts/plugins/site.ts: PluginComment.migrated?: boolean and PluginComment.origin?: string, both ways, so phase (c) only has to fill them.
- web/conversation.ts: Interaction gains guid and migrated. Each constructor sets its guid: a stored comment's is its /comment/{key}/ page when its source is comment, else its origin, else its url; an inbox reply's, a quote's and a reply post's is its id. feedComments names entry.guid and entry.parent.guid, so a native reply under a migrated comment names its page (form comment) or its origin, else its url, in source:inReplyTo. repliesFed (direct replies less migrated ones) is what counts (source:comments on post feeds), /replies/{key}/ items and each item's source:comments use; spokenIn and the site-wide latest leave migrated entries out. The thread, the page and /comment/{key}/ are unchanged, so a migrated comment shows and its replies thread under it. The feed ETags follow, since their fingerprints are built from the items and counts.
- Deleted: replyGuid in web/guids.ts (its switch could not tell a stored activitypub record from an inbox one; the guid now lives where each entry is built). A stale guids.ts header line about the admin store keying /replies/ feeds went too. Nothing else special-cased imported ids: isPermaLink is the generic guid === link test.

Choice: /replies/{key}/ of a migrated comment still answers, listing the native replies under it, though nothing advertises it, since the comment is in no feed. A native reply under a migrated top-level comment is in {permalink}feed/ and /comments/feed/ but reachable by no source:comments walk from the post.

Verification: new web/migrated-comments.test.ts (red before the change: feeds held migrated items and counted them); records and plugin round-trip tests. pnpm build, pnpm -r test (cms 5399 pass, all packages 0 fail), pnpm -r typecheck, pnpm lint, pnpm format:check pass. Scratch site scratchpad/site336b on dist/cli.js: migrated form, fediverse, webmention and like comments all on the post page; /comment/{form key}/ 200 with the native reply and a reply post under it, /comment/{fediverse key}/ 404; {permalink}feed/ and /comments/feed/ hold only the three native comments and the reply post, with source:inReplyTo naming /comment/{key}/, the fediverse origin and the webmention source; /feed/ gives the post no source:comments; /replies/{post key}/ is empty. Server stopped.

AC#6 and AC#11 checked. Task stays In Progress for phases (c) and (d).

Phase (c), plugin-wordpress import (2026-10-10).

Built:
- Core exports the key rule to plugins: repliesKey and webmentionKey from @geekity/cms/plugin. webmentionKey moved from comments/records.ts to web/feed-source.ts beside repliesKey, so the plugin bundle inlines only that file.
- PluginSite.renameComments(permalink, renames) (comments/records.ts renameComments): each held comment a rename names takes its new id in its place; its email in data/ follows; every reply in the file naming the old id names the new one; the index drops the old row and puts the new ones. Refuses, changing nothing, a new id the post already holds. Optional addition to the plugin API, so HOST_API_VERSION stays 1.
- geekity <plugin command> now runs migrateCommentEmails and migrateCommentKeys before the command, as a boot does, so an import run on a 0.2.0 site that has not booted since upgrading meets only keys instead of a refusal.
- comments-import.ts: every comment is migrated: true. origin = source_id for an activitypub comment (the note for a reply, the activity for a like or boost; url keeps the note's web page), and for a webmention its url (webmention_source_url, or a pingback/trackback's author URL) else source_id. Key = repliesKey(origin) for activitypub, webmentionKey(origin, permalink) for webmention, repliesKey(WordPress comment URL) with no origin. inReplyTo is the parent's key. idOf and its comment went.
- content-import.ts writeComments: renames each held comment at repliesKey(formerId) (what the boot gave a 0.2.0 id) to its key; carryOver moves an import.json entry recorded under the 0.2.0 id to the key, keeping 'the import wrote this' only when the held comment, read back under its 0.2.0 ids, still hashes to what 0.2.0 recorded; a comment the import owns but the site edited keeps its words and status and is still marked migrated with its origin. ImportedComment gained formerId.
- README (plugin-wordpress): migrated, origin and key table, upgrading from 0.2.0, #comment-N no longer scrolls.

Choice: the 5 Bluesky reactions in the andrewshell.org export (4 likes, 1 repost, no protocol, source_url empty) keep source_id (an at:// URI) as origin and are keyed webmentionKey(origin, permalink); nothing native would arrive with that identity today, but it is kept, as AC#5 names source_id.

Andrew's export (real WXR): 68 comments imported. activitypub: 28 boosts, 12 likes, 1 reply, all with origin (source_id). webmention: 9 mentions (7 pingbacks, 1 mention, 1 bookmark), 1 reply, 1 repost, all with origin (webmention_source_url or pingback author URL); 4 likes and 1 repost with an at:// origin. 11 form comments, no origin. All 68 migrated, 68 distinct keys.

Not done here: a redelivered activity or a reply backfill lands in the inbox log, so its dedupe is gather()'s (AC#10, phase d); the README says only that a webmention resend is the held comment. A Markdown document linking #comment-{old key} of a renamed fediverse or webmention comment is not rewritten (those comments have no /comment/ page; form comments keep their key).

Verification: new tests in plugin-wordpress comments-import.test.ts (origin/key/migrated per source with the webmention key checked against the permalink the site serves; a webmention resend through intakeComment is the held record; /comments/feed/ and the post feed hold no item while the page anchors the replies; a 0.2.0-shaped import, booted, with a native reply under a fediverse comment and a moderator's spam call, re-imported: one record per comment in place under its key, the native reply follows, spam kept and migrated, import.json keyed by keys, no clash, a further run unchanged), plugins/site.test.ts (renameComments) and cli-plugins.test.ts (comment ids are keys before a plugin command). Each new test was seen failing with its defect put back (no rename, no carry-over, no identity patch, no migrated, keys by URL, no inReplyTo follow, no CLI migration). pnpm build, pnpm test (cms 5401, plugin-wordpress 94, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check pass.
Scratch sites from the real WXR: site336c (fresh import, served on dist/cli.js): /comments/feed/ and all 16 {permalink}feed/ answer 200 with no item and no imported id, origin or url in them; with one form comment's migrated flag removed (positive control, a copy) that comment appears in both feeds; the 13 imported replies are anchored on their posts. site336d: plugin-wordpress 0.2.0 (git worktree at plugin-wordpress-v0.2.0 on its own core) imported the WXR, the new core booted (ids re-keyed), the new plugin re-imported: 68 written ('written again with its key, migrated and its origin'), 0 clash, 68 records, 68 import.json entries all keys, and content/_data/comments and data/comments byte-identical to the fresh import; another run 0 written. site336e: same without the boot (the CLI migrates first): same result. Servers stopped; worktree removed.

AC#5 checked on the orchestrator's split: the importer keeps and keys by the origin, and a webmention resend matches (tested); the redelivered activity and reply backfill half is enforced in gather() and proved under AC#10 in phase (d). AC#9 stays open: the plugin-wordpress README is done, the core README's comments, replies feed and theme sections are not this phase's.

Phase (d), inbox dedupe and the core READMEs (2026-10-10).

Built:
- web/conversation.ts heldComment(admin, id): the stored comment whose origin is this fediverse note or activity id, found by its key (repliesKey(id), since an imported fediverse comment is keyed by its origin) and confirmed by its origin. The one rule used by gather, siteConversation, documentNamed and the backfill.
- gather(): an inbox reply (delivered or fetched; compared by note id, so a fetched line's {note id}#fetched is covered) or reaction (by activity id) that a stored comment holds is dropped, so the stored record wins with its moderation and anchor. The log walk (activitiesAround now takes several seeds) starts from the thread's activitypub origins too, so an answer to an imported note that no logged Create carries is found; an inbox reply whose inReplyTo is a held origin threads under the stored record. Likes and boosts are one per person by author URL (the actor's profile page when the site holds it, else the actor id), and the thread's imported activitypub reactions are seeded into that set, so the same person's like under a new activity id folds into the imported one.
- siteConversation drops a held inbox reply; documentNamed finds a held origin's post, so an answer to an imported note is in /comments/feed/ (and its count) and names the note in source:inReplyTo.
- federation/backfill.ts: level() names each fediverse reply by its guid, so an imported reply's collection is read by its note id rather than its key (before, the backfill asked for a 16-hex key and learned nothing); a note a stored comment holds is not logged.
- README (Keys, Migrated comments, A comment's own page, Comments feeds, Walking a thread, Replies to fediverse replies, URL tables) and themes/default/README.md (id, guid, migrated rows; the like rule; the imported-reaction rule) describe the key rule and migrated comments. The stale id-or-key segment rule and the claim that an imported comment keeps its WordPress guid are gone.

Not folded: a re-like by an actor whose profile the site does not hold under a new activity id shows beside the imported like, because the imported like carries only the profile page (comment_author_url) and the inbox row only the actor id. A same-id redelivery always folds.

Verification: six new tests in federation/backfill.test.ts (redelivered Create shows once and is in no feed; earlier fetched line shows once; the backfill reads the imported note by its origin, threads Bob under the imported record, does not log the note, and feeds Bob; a collection listing the imported note does not log it; a redelivered Like shows once; a re-like under a new id from a known actor folds), each red before the change, and each guard (backfill held check, documentNamed, site feed, walk seed, reaction held, fold seed) seen failing a test when removed. pnpm build, pnpm test (cms 5407, plugin-wordpress 94, all 0 fail), pnpm typecheck, pnpm lint, pnpm format:check pass. Scratch site scratchpad/site336f: fresh import of the real WXR with dist/cli.js and plugin-wordpress, plus inbox lines for a redelivered Create of the imported elettrona reply, a fetched reply from bob answering that note, and a redelivered Announce of an imported boost; served: the post page shows the imported reply once (anchor comment-1ff76a7b231fd7f3, no redelivered text), Bob nested under it, Boosts 2 (not 3), '2 replies'; /comments/feed/ and the post's feed hold one item, Bob's, with source:inReplyTo naming the imported note's id. Server stopped.

plugin-wordpress README: the sentence that named only a webmention resend now names a redelivered or backfilled fediverse reply or reaction too.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every comment and repliable item has one 16-hex key (decision-51, superseding decision-48's id-or-key segment rule): a form comment's is minted at random, a webmention's is the hash of its source and post, a fediverse item's and a document's the hash of its guid; core refuses any other stored id, and UUID and 0.2.0 URL ids are re-keyed in place at boot. Anchors, /comment/{key}/, /replies/{key}/ and every printed URL use the key, unencoded. Comments imported from another system carry migrated: true and their origin; they show on the page and in the thread but are in no feed and no advertised count, and a native reply under one names its guid in source:inReplyTo. plugin-wordpress marks every imported comment migrated, keeps source_id and webmention_source_url as origin, keys by it, and renames a 0.2.0 import in place without clashes. A webmention resend, a redelivered Create or Like, and a backfilled note matching an imported comment's origin show once as the stored comment (heldComment in web/conversation.ts, used by the thread, the site feed and the backfill), and answers to an imported note thread under it. Verified by unit and integration tests (cms 5407, plugin-wordpress 94, 0 fail), pnpm build/typecheck/lint/format:check, and scratch sites built from the real andrewshell.org WXR: no imported comment in /comments/feed/ or any {permalink}feed/, a 0.2.0 import upgraded with no clash, and redelivered and backfilled fediverse copies shown once.
<!-- SECTION:FINAL_SUMMARY:END -->
