---
id: TASK-447
title: >-
  The dashboard lists recent interactions across comments, webmentions and the
  fediverse
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 23:51'
labels:
  - dashboard
  - comments
  - federation
milestone: m-41
dependencies:
  - TASK-444
priority: medium
ordinal: 384800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the old Recent posts space with what people did: one list, newest first, of comments, webmentions, fediverse replies, likes and boosts, and new followers, each linking to where the owner acts on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The widget lists the ten newest interactions across comments, webmentions, fediverse replies, likes, boosts and new followers, newest first
- [x] #2 Each entry names who, what kind, which post, and when, and links to the comment, the post or the follower
- [x] #3 Pending comments are marked as waiting, and spam or rejected ones are left out
- [x] #4 A site with no interactions shows a short empty state
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: AdminStore.listLatestInteractions(limit) in store/inbox.ts, the same deduped Undo/Delete-aware likes/boosts/replies as listInteractionsSince (shared SQL), newest first, with actorId and what each is about (object_id for a like/boost, in_reply_to for a reply). CommentStore.listLatestComments(limit): newest first, spam and activitypub-source rows left out. Followers via listFollowers().
2. Blocks: a table cell may be a link {text, href}; drawBlock keeps the href only when it is a path or web address (safeHref), blocks.njk draws it as a link. Text and link cells wrap anywhere so a narrow card does not scroll. Document in docs/plugins.md.
3. Widget packages/cms/src/admin/widget-interactions.ts (id recent-interactions, Recent interactions, half width) after followers in CORE_WIDGETS: ten newest regardless of period; table Who / What / When, What naming kind and post as one link (comments to /admin/comments?status=<status>#comment-<id>, with the anchor added to the moderation list; fediverse to the post editor via localPosts; followers to /admin/federation). Fediverse activity about something that is not one of the site's posts is left out (4x over-read). Pending reads as waiting. Empty: one paragraph.
4. Tests first per AC, then full checks and 1280/390 screenshots.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Sources: comments table via new listLatestComments (status != spam, source != activitypub). Live fediverse replies never become comment rows (activitypub-source rows are pre-Geekity imports, store/comments.ts), so the inbox is the only fediverse source and nothing shows twice; imported fediverse comments are left out of the list. Likes/boosts/replies via new AdminStore.listLatestInteractions(limit), which shares its SQL with listInteractionsSince (one per actor+object for likes/boosts, one per note for replies, undone/deleted left out). New followers from the followers table's followed_at (follower-history.jsonl records counts, not who).
Links: comment -> /admin/comments?status=<status>#comment-<id> (each moderation card now has id=comment-<id>; there is no per-comment admin page); like/boost/reply -> the post's editor through localPosts() in admin/federation.ts; follower -> /admin/federation.
The list is the ten newest whatever the 7/30 period, by design: a period-bounded list would go empty on a quiet week. Fediverse activity about something that is not one of the site's posts (a like reaching the shared inbox about somebody else's note) is left out; 40 are read to fill ten.
Layout: a four-column table (Who/What/Post/When) overflowed the half card, so What carries the kind and post in one link and When is a short '20 Oct, 17:48' in the site's zone. Table text and link cells in blocks.njk got wrap-anywhere so long @handles wrap instead of scrolling the card at 390px.
Block vocabulary: table cells accept {text, href}; href kept only for a path or http(s) address, else drawn as text. Documented in docs/plugins.md; docs/admin.md lists the widget.
Validation: pnpm build && pnpm test (cms 6444 pass) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Headless Chromium at 1280 px: the card fills the right column beside Followers; at 390 px no horizontal page scroll (scrollWidth 390) and the table fits the card.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Recent interactions dashboard widget (half width, after Followers): the ten newest comments, webmentions, fediverse likes/boosts/replies and new followers, newest first, whatever the period. Each row names who, the kind and the post, and when, and links to the comment's place in the moderation list, the post's editor, or the federation screen. Pending comments read as waiting; spam and imported fediverse comments are left out; an empty site gets a one-line message. New store queries listLatestInteractions and listLatestComments; table blocks gained link cells {text, href}. Verified with widget-interactions.test.ts, store and blocks tests, the full check suite, and headless Chromium screenshots at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
