---
id: TASK-291.3
title: >-
  WordPress import: comments, webmentions and fediverse reactions become comment
  records
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 18:37'
labels: []
milestone: m-31
dependencies: []
parent_task_id: TASK-291
ordinal: 250800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site that ran the ActivityPub and Webmention plugins holds its likes, reposts, replies, mentions, bookmarks and pingbacks as wp_comments rows with plugin meta. Each becomes a Geekity comment record on the same post, so the reaction counts and conversations a reader saw under WordPress are still there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each approved comment is written to content/_data/comments/{slug}.json in the CommentRecord shape, and a commenter email, when present, only to data/comments/{slug}.json
- [x] #2 comment_type like, repost, comment, mention, bookmark, pingback and webmention map to the matching Geekity kind and source, keeping the remote URL and author
- [x] #3 Threaded replies keep their parent
- [x] #4 Spam and trash are not imported; pending comments import as pending
- [x] #5 A post's reaction counts on the Geekity site equal those WordPress showed, in a test over a fixture export
- [x] #6 An imported comment keeps the id WordPress published in its comments feed (https://<site>/?p=ID#comment-N), so a comments-feed reader sees no imported reply as new
- [x] #7 Imported comments are never left pending, so no moderation digest email lists them
- [x] #8 A rerun merges by WordPress comment id into a post's comment file: new WordPress comments are added, already-imported ones are left alone, and comments the Geekity site received itself after going live are never touched or reordered
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (fix): a comment file is named by the post's slug percent-encoded, so a post whose slug is not ASCII (andrewshell.org's /2026/07/i-♥-rss/) can hold comments; ASCII slugs keep their names. The theme's Reply link URL-encodes the comment id.
2. Core (feat, decision-33 extension point): COMMENT_SOURCES gains activitypub, the source the conversation already uses for a fediverse reaction. PluginSite gains comments(post) and putComments(post, comments), keyed by the post's permalink: core derives the slug, renders the Markdown through its restricted comment profile, splits the email into data/comments/, replaces each entry by id in place or appends it, touches no other entry, and announces nothing.
3. Plugin: src/comments-import.ts, a WordPressImporter claiming no post types. It reads items[].comments of every post and page the posts import writes (placements shared with posts-import.ts, not recomputed), maps comment_type plus protocol meta to source and kind, keeps url and author, threads by parent, takes status 1 as approved and 0 as pending, skips spam and trash, ids each comment as WordPress's comments feed guid (<post guid>#comment-N), and rewrites media URLs in bodies.
4. Writer: ImporterOutput.comments, a merge write by comment id. import.json records a sha256 per post and comment id; each entry is decided by the same three hashes as a file (decision-38), and only the entries to write go to putComments, so a rerun leaves the file byte-identical and a live comment is never touched or moved.
5. Tests first for each AC: mapping, threading, statuses, the counts on a served page over a fixture export, the feed guid, no digest/announcement/outbound request, the rerun merge with a live comment present, and the parent's #10 reactions half.
6. decision-41 for the source and kind mapping, the id, pending versus approved, and the core API. Real CLI over the real export into a scratch site, served, curled.

Revised during build: a comment deleted on this site is never written again (unlike a removed file, decision-38), since a moderator deleting it is not a request for WordPress's copy. Media URLs inside a comment are made absolute on the site's base URL, because the comment Markdown profile publishes no relative link.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Core (fix): comment files are named by the slug percent-encoded (records.ts fileNameOf/slugOfFileName), so a non-ASCII slug such as andrewshell.org's i-♥-rss (7 reactions, the most of any post) can hold comments at all; before, commentsFile threw. An ASCII slug encodes to itself, so no existing file moves. The Eleventy example config and README follow. The default theme's Reply link URL-encodes the comment id (an imported id carries ? and #, which cut the reply_to query).
- Core (feat, decision-33 extension point): COMMENT_SOURCES gains activitypub (the conversation and theme already knew it). PluginSite.comments(permalink) and PluginSite.putComments(permalink, comments) with PluginComment/PluginPostComments in plugin.ts; records.ts putComments replaces by id in place or appends, under the file lock, renders Markdown through renderCommentMarkdown, splits the email to data/, updates the index, and announces nothing. slugForPermalink exported from parser.ts so core derives the slug exactly as for the post.
- Plugin: src/comments-import.ts (commentsAndReactions, postTypes []), using posts-import's new placements() so a comment lands on the permalink the posts import wrote. content-import.ts gains ImporterOutput.comments and writeComments, a merge write by id recorded in import.json under comments (sha256 of a canonical JSON per file and id). media.rewrite takes an optional origin.
- decision-41 records the mapping, the id, pending versus approved, and the core door.
AC #4 and #7 read together: WordPress status 1 imports approved (never pending, so no digest lists it), status 0 imports pending (it was waiting on WordPress too); andrewshell.org has no status-0 comment.
Evidence:
- test/comments-import.test.ts (11 tests): shape and email split (#1), mapping table (#2), threading (#3), spam/trash/pending (#4), counts on the served page over a fixture export: Likes 3, Boosts 3, Mentions 3, 2 replies as WordPress showed (#5), the post feed and /comments/feed/ guids are WordPress's ?p=ID#comment-N (#6), no pending after boot (#7), the rerun merge with a live comment, a moderator's spam and a WordPress edit (#8, parent #10), a deleted comment stays deleted, byte-identical rerun, a comment on a trashed post skipped. Mutations that drop the deleted-here rule or write every entry each fail a test.
- test/import-dev-mode.test.ts: the import, comments included (a pending one among them), into a running dev-mode site with a follower, mail configured and a moderator with an email: no outbound fetch, nothing held (no mail, activity, webmention, ping).
- Core: records.test.ts (non-ASCII file name, boot rebuild, path guard), plugins/site.test.ts (putComments/comments, replace in place, live entry byte for byte), comments/site.test.ts (Reply link carries a URL id whole). Each failed first for the intended reason.
- Real CLI over the andrewshell.org export into a scratch site: exit 0, 68 comment rows written, comment 536 skipped (trash); rerun 273 unchanged and the content and data byte-identical. Served in dev mode: /2026/07/i-%E2%99%A5-rss/ shows Likes 2, Boosts 3, Mentions 5, One reply (all 11 of its rows); all 10 guids of the baseline WordPress comments feed are imported ids; dev-mode.jsonl held nothing.
- pnpm build, test (cms 5154, plugin-wordpress 85, all pass; migrated-site watcher wait flaked once under the full suite and passed alone and on rerun), typecheck, lint, format:check pass.
Found: on a site with no accounts the first geekity sync warns 'A delivery failed' for the two migrated reply posts. It comes from delivery.citedPageStored fingerprinting postObject, whose attribution throws with no accounts. With an account and dev mode on, the same sync holds nothing, so the import stays silent. Filed TASK-311.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
WordPress comments, webmentions, pingbacks and fediverse likes, reposts and replies now import as comment records on the post they were on, through a new core door (PluginSite.comments/putComments, COMMENT_SOURCES gains activitypub) that owns the file format, renders Markdown safely, keeps emails in data/ and announces nothing. Each keeps WordPress's comments-feed id, its parent, its remote URL and author; spam and trash are skipped, held comments stay pending. Reruns merge by comment id, leaving live comments, moderator decisions and deletions alone. Core also fixed: a non-ASCII slug can now hold comments (percent-encoded file name), and the theme's Reply link encodes the id. Verified by 11 plugin tests, the dev-mode silence test, core tests, and the real andrewshell.org export imported, rerun byte-identical and served with every reaction count and every baseline comments-feed guid matching. decision-41; TASK-311 filed for a spurious sync warning.
<!-- SECTION:FINAL_SUMMARY:END -->
