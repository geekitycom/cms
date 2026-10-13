---
id: TASK-335
title: Hide likes and boosts from comments and replies feeds
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 21:34'
updated_date: '2026-10-11 00:15'
labels:
  - bug
milestone: m-31
dependencies:
  - TASK-336
references:
  - packages/cms/src/web/routes.ts
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/feed-guids.tsv
priority: medium
ordinal: 294800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Andrew, 2026-10-10: likes and boosts are reactions, not comments. They belong on the page, not in a feed someone reads for conversation.

Today every approved comment record is a feed item, whatever its kind. Since v0.29.0 there are three kinds of feed that carry them: /comments/feed/, each document's {permalink}feed/, and the /replies/{key}/ feeds that source:comments links point at. So a post with 30 boosts is a comments feed of 30 boosts.

Seen on the andrewshell.org migration. The cutover side of it is now TASK-336's: imported comments are migrated and stay out of every feed, so imported reactions can't reach one. This task is the general rule for reactions that arrive on Geekity itself. For the record: Prod's /comments/feed/ (WordPress with the ActivityPub plugin) lists only replies and mentions: 7 mentions and 3 replies in the 2026-10-08 baseline (asdo_geekity _local/snapshot/baseline/feed-guids.tsv, comments_feed.xml). Geekity's newest 10 are 9 likes and boosts on posts 1130 and 813, plus one of prod's mentions. At cutover a comments-feed subscriber would see 9 items WordPress never published. The behaviour is the same on v0.28.0.

Rule: a feed of comments or replies carries only conversational records, replies and mentions. Likes, boosts and reposts are left out of every such feed and every reply count a feed advertises. A webmention repost is the IndieWeb form of a boost. Reactions stay on the page and in the comment data exactly as now.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /comments/feed/, every {permalink}feed/ and every /replies/{key}/ feed list replies and mentions only; likes, boosts and reposts are left out
- [x] #2 The reply counts the feeds advertise (source:comments, and the counts decision-48 defines) count only what those feeds list, and an item whose only responses are reactions advertises no replies feed; decision-48's wording is updated to say so
- [x] #3 Reactions still show on the post or page, with their counts, exactly as before
- [x] #4 The README's feeds and replies feed sections say which comment kinds a feed carries
- [x] #5 Tests pin all three feeds, including {permalink}feed/ and /replies/, which may already leave reactions out because a post's thread groups likes, boosts and reposts apart from replies (web/conversation.ts gather); the site-wide /comments/feed/ is the confirmed leak (siteConversation reads every approved comment record whatever its kind)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One predicate, conversational(entry) in web/conversation.ts: not migrated, and a reply or a mention. spokenIn ({permalink}feed/), repliesFed (/replies/{key}/, each item's source:comments, the post feeds' counts) and siteConversation (/comments/feed/) all filter by it; the per-feed migrated checks go.
2. siteConversation takes each stored comment from its post's thread (replies at every depth plus mentions) instead of reading the record on its own, so what the thread holds apart (likes, boosts, reposts, an event's RSVPs) is left out exactly as {permalink}feed/ leaves it out. This is the confirmed leak.
3. RSVPs: an RSVP to an event is shown as a facepile in the RSVP groups, never as words in the thread, so it is no feed's, words or not; an RSVP sent to a post that is no event is threaded as a reply and fed. Recorded in the README and the decision-48 wording.
4. TDD: web/conversational-feeds.test.ts pins /comments/feed/, {permalink}feed/, /replies/{key}/, source:comments counts, a reactions-only post with no replies feed, and the page's reaction counts.
5. README Comments and Walking a thread sections name the kinds each feed carries; decision-48 wording text handed to the orchestrator (no backlog CLI command edits a decision).
6. pnpm build/test/typecheck/lint/format:check; scratch site from the andrewshell.org import with migrated removed, served and curled.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built (2026-10-11):
- web/conversation.ts: conversational(entry), not migrated and a reply or a mention, is the one rule for what a feed carries and a count counts. spokenIn ({permalink}feed/), repliesFed (/replies/{key}/, every item's source:comments, the post feeds' counts via directCounts) and siteConversation (/comments/feed/) all filter by it; the separate migrated checks in spokenIn, repliesFed and siteConversation went.
- siteConversation took every approved comment record whatever its kind (the confirmed leak): it now takes each stored comment from its post's thread (saidIn: mentions plus every visible reply with its parent), so a like, boost, repost or event RSVP, which gather() holds apart from the thread, is left out exactly as the post's own feed leaves it out. The site feed and the post feed now read stored comments one way.
- {permalink}feed/ and /replies/ already left reactions out (the thread holds only replies; likes, boosts and mentions are their own groups). Pinned by tests either way.

Choice (RSVPs): an RSVP to an event (a post with start) is shown as a facepile in the RSVP groups, never as words in the thread, so it is in no feed and no count, words or not. An RSVP sent to a post that is no event is threaded as a reply, and fed like one. Recorded in the README Comments section and the decision-48 wording handed to the orchestrator.

Note: the kind half of conversational() is not decisive today, since only replies and mentions reach saidIn; it states the rule where every feed and count reads it, so a later change that threads something else is still held to it.

Verification: new web/conversational-feeds.test.ts (a post with a form reply, a webmention reply, a non-event RSVP reply, a mention, a like, a repost and an activitypub boost; a post with only a like and a repost; an event with an RSVP with words). Red before the change: /comments/feed/ carried the likes, reposts, boost and the event RSVP; the other seven tests (post feeds, /replies/, counts, page reaction counts) passed before and after. pnpm build, pnpm test (cms 5415, demo 32, plugin-llm 48, plugin-post-summary 22, plugin-tag-suggest 31, plugin-wordpress all pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check pass.
Scratch site scratchpad/site335: the fresh andrewshell.org import (site336c) with migrated removed from all 68 comments, so they read as native (13 replies, 9 mentions, 28 boosts, 16 likes, 2 reposts), served on dist/cli.js: /comments/feed/ 20 items, every {permalink}feed/ and every /replies/ feed reached from /feed/'s source:comments (5 posts, counts 1,1,1,3,1): 0 of the 46 reaction guids appear in any of them; /2026/07/rsscloud-server-4-0-now-supports-websub-notifications/ (5 likes, 3 boosts, 1 repost, no replies) shows Likes 5 and Boosts 4 on its page, has an empty {permalink}feed/ and no source:comments in /feed/. Server stopped.

AC#2 stays open: the counts hold (tested and curl'd), but decision-48's wording needs the orchestrator to apply the text in the report, since no backlog CLI command edits a decision.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Comments feeds and reply counts carry only what was said: replies and mentions. One predicate, conversational() in web/conversation.ts (not migrated, a reply or a mention), filters {permalink}feed/, /comments/feed/, /replies/{key}/ and every source:comments count. /comments/feed/ was the leak: siteConversation read every approved comment record; it now takes each stored comment from its post's thread, so likes, boosts, reposts and an event's RSVPs (shown as facepiles, never as words in the thread) are left out as the post feed leaves them out. Reactions still show on the page with their counts. README Comments and Walking a thread sections name the kinds. Verified by web/conversational-feeds.test.ts (red on /comments/feed/ before), the full pnpm build/test/typecheck/lint/format:check, and a scratch site of the andrewshell.org import with migrated removed: no reaction in any comments or replies feed.
<!-- SECTION:FINAL_SUMMARY:END -->
