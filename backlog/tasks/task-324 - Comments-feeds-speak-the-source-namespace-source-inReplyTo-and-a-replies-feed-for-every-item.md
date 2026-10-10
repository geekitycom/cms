---
id: TASK-324
title: >-
  Comments feeds speak the source namespace: source:inReplyTo, and a replies
  feed for every item
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 13:14'
updated_date: '2026-10-10 15:03'
labels:
  - feeds
  - comments
dependencies:
  - TASK-318
  - TASK-319
references:
  - 'https://source.scripting.com'
  - 'https://github.com/scripting/rss.chat/blob/main/server/code/worknotes.md'
  - 'https://users.rss.network/manton/comments/204.xml'
  - packages/cms/src/web/feed-rss.ts
  - packages/cms/src/web/conversation.ts
priority: low
type: feature
ordinal: 283800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dave Winer's rss.chat publishes conversations so a program can walk them from feeds alone (https://source.scripting.com, https://github.com/scripting/rss.chat/blob/main/server/code/worknotes.md, entry of 7/8/26, live example https://users.rss.network/manton/comments/204.xml). Every reply item carries `<source:inReplyTo>` holding its parent's guid. Any item with replies carries `<source:comments count="N" feedUrl="…"/>`, where count is the number of direct replies and feedUrl a feed holding only those replies. Each reply in that feed carries its own source:comments, so the tree is walkable one level at a time. Items in a feed that mixes authors carry core RSS `<source url="author feed">Name</source>`.

This site already emits source:comments on post items (web/feed-rss.ts), but its count is the whole conversation (commentCounts, web/conversation.ts) and its feedUrl the post's whole-thread feed, and comments feed items carry no source:inReplyTo.

URLs:
- `/replies/{id}/`: the RSS feed of a native comment's direct replies, by its id (its page is `/comment/{id}/`, TASK-318).
- `/replies/{key}/`: the same for a post or page, and for a webmention or fediverse reply, keyed by a short hash of its feed guid (a document has no id of its own, and slugs are not unique across posts and pages).
- `{permalink}feed/` stays the whole thread, flat, for `wfw:commentRss` and WordPress parity, and `/comments/feed/` stays the whole site.

A post item's source:comments points at its `/replies/{key}/` feed with a direct-replies count; `<comments>` and `wfw:commentRss` keep pointing at the page and the whole-thread feed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every item in every comments feed carries source:inReplyTo holding the guid its parent has in these feeds: the post's feed guid for a top-level reply, else the parent comment's guid
- [x] #2 A native comment's guid in the comments feeds is its comment page URL (isPermaLink true), so source:inReplyTo and guid match
- [x] #3 /replies/{id}/ and /replies/{key}/ answer RSS 2.0 feeds of exactly the direct replies of that item, newest first, each item in the same shape as the comments feeds; an item with no replies answers an empty feed, and an unknown id or key 404s
- [x] #4 An item with replies, in any feed, carries source:comments with count equal to its direct replies and feedUrl its /replies/ feed; an item with none carries no source:comments
- [x] #5 A post or page item's source:comments in the post feeds points at its /replies/{key}/ with a direct-replies count, while <comments> and wfw:commentRss are unchanged
- [x] #6 An item whose author has a known feed (a webmention author's h-card or site, or a site user) carries <source url> naming it; others carry none
- [x] #7 Walking from a post item through source:comments feeds reaches every reply in its thread exactly once, shown by a test that walks a three-level thread mixing native, webmention and fediverse replies
- [x] #8 The CMS README feeds section documents the source namespace elements and the /replies/ URLs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: every entry a comments feed prints gets a guid (a native comment's page URL, else its id), the guid of the visible entry it sits under (the post's feed guid at the top; a hidden comment between is passed over, as threadOf already passes over a withdrawn note), its direct visible replies (through withheld placeholders) and its author's feed (webmention author url, a site user's author feed). One reading: ConversationReader.thread, walked once into placements.
2. feedGuid(document, baseUrl) moves to web/documents.ts so the post feeds and the comments feeds share the post's guid.
3. /replies/{segment}/: a segment of exactly 16 lowercase hex is a key (sha256 of the guid, first 16 hex); anything else is a native comment id. A native comment whose id happens to be key-shaped is addressed by its key, so every item has one URL and every URL one item. ConversationReader.replies(segment) resolves: native comment via comment(id); key via served posts and pages by feed guid, then stored comments, logged fediverse replies and reply posts by their guid, each found in its post's thread.
4. counts() becomes direct visible replies per document, read from the thread (replaces the index approximation); post feed source:comments points at /replies/{key}/ and is printed only when count > 0; <comments> and wfw:commentRss unchanged. Bump FEED_ITEM_REVISION and COMMENTS_FEED_REVISION; fingerprint the new fields.
5. RSS comment items: guid isPermaLink by guid === link, source:inReplyTo, source:comments, <source url>.
6. Tests first per AC, including a walk test over a three-level native/webmention/fediverse thread; README feeds section; verify with a scratch site and curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. ConversationReader.thread is the one reading: spokenIn/latest return Placed entries (parent = nearest visible reply, null for the post); counts() is now direct visible replies read off each thread (index approximation commentCounts/replyPostsAnswering and AdminStore.countCommentsFor deleted). New ConversationReader.repliesTo(segment) and route /replies/:segment/. feedGuid(document, baseUrl) moved to web/documents.ts. Keys: first 16 hex of sha256(feed guid); a 16-lowercase-hex segment is a key, anything else a native comment id, and a native comment whose id would read as a key is addressed by its key (decision-48).
Choices: a reply under a hidden (pending/spam/deleted) comment names the nearest visible reply above it (or the post) in source:inReplyTo and is in that one's /replies/ feed and count, matching how threadOf already passes over a withdrawn note; so the post feed count for comment-page.test's post is 7 direct, not 13 total. Mentions keep source:inReplyTo = post guid but are not replies, so they are in no /replies/ feed and no count. A native comment imported with a URL id (WordPress '{guid}#comment-N') keeps that id as its guid, so plugin-wordpress's 'reader sees nothing new' promise holds; comments written here get their page URL (AC#2). isPermaLink is guid === link for every comment item, so a fediverse note with no url (link = id) is now isPermaLink true. Fixed on the way: /comments/feed/ dropped fediverse notes that answer another note (siteConversation looked the target up as a post); it now finds the post with documentNamed. Pages: /replies/{key}/ answers for a served page (test covers it); {permalink}feed/ for pages is still TASK-323. <source url> is printed in comments feeds only, not on post feed items.
Validation: new src/web/replies-feeds.test.ts (12 tests, one per AC incl. the three-level native/webmention/fediverse/reply-post walk); updated golden, enclosure fixtures (FEED_ITEM_REVISION 14, COMMENTS_FEED_REVISION 4) and count expectations. pnpm build, typecheck, lint, format:check pass; pnpm test: cms 5266/5266, plugin-llm, demo pass; plugin-wordpress failed once until cms dist was rebuilt with the imported-guid rule, then 91/91. Scratch site curl: /feed/ source:comments count=1 feedUrl=/replies/007ed746c1a3198b/; post comments feed items carry guid/inReplyTo/source:comments/<source url>; walked /replies/{key}/ -> /replies/{a1}/ -> /replies/{a2}/ -> /replies/{key of a3}/ (empty, 200); unknown key and id 404.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Comments feeds now speak the source namespace as a walkable tree. Every comments-feed item carries source:inReplyTo (its parent's guid, or the post's feed guid), source:comments (direct replies and their /replies/ feed) only when it has replies, and <source url> for a webmention author or site user. A native comment's guid is its /comment/{id}/ page (isPermaLink true); WordPress-imported ones keep their published guid. New /replies/{id}/ and /replies/{key}/ RSS feeds (key = 16 hex of sha256 of the feed guid) answer posts, pages, native comments, webmentions, fediverse notes and reply posts; unknown ones 404. Post feed source:comments counts direct replies and points at /replies/{key}/; <comments> and wfw:commentRss unchanged. counts() is read from the thread. README documents it; decision-48 records the model. Verified by src/web/replies-feeds.test.ts (incl. a three-level mixed-source walk), the full suite, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
