---
id: TASK-318
title: A visitor comment has a page of its own that other sites can reply to
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:30'
updated_date: '2026-10-10 13:36'
labels:
  - comments
  - indieweb
dependencies: []
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/themes/default/partials/conversation.njk
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
priority: medium
type: feature
ordinal: 277800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A native comment, one a visitor left through the comment form, has only a fragment URL today: `permalink#comment-<id>` (web/conversation.ts). Another site that replies to it fetches that URL for its reply context and gets the whole post page, so whether it quotes the comment or the post depends on its parser. A webmention aimed at the fragment is resolved by path alone (webmention/receive.ts), so it cannot name the comment either.

Give each native comment a page of its own at `/comment/{id}/`, its existing id, that serves the comment as the page's only h-entry, with u-in-reply-to pointing at the post. The comment's u-url becomes that page. The fragment anchor on the post page stays, so existing links keep scrolling to the comment.

Only native visitor comments need this. A webmention reply's URL is its sender's page and a fediverse reply's URL is the remote Note, and both stay so: clicking their timestamp goes to their site. Replies from signed-in users become reply posts (TASK-300), which have URLs already.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An approved native comment answers 200 at its own URL with an h-entry for the comment alone: author h-card, content, published date, u-url equal to that URL, and u-in-reply-to the post it is on (or the comment it answers)
- [x] #2 A pending, spam or trashed comment, and the comment page of a draft or unpublished post, answer 404 or 410 as the post itself would
- [x] #3 The thread on the post page prints the comment's u-url as its own page; the #comment-<id> anchor still exists and still scrolls to it
- [x] #4 A webmention or fediverse reply keeps its sender's URL as its u-url and gets no page of its own
- [x] #5 The comment page is noindex and is absent from the sitemap, feeds and search
- [x] #6 doc-6 Native Comments and the CMS README describe the comment page
- [x] #7 In the post's comments feed and /comments/feed/, a native comment's item links to its own page rather than the #comment-<id> fragment
- [x] #8 Above the comment, its page shows the thread it belongs to, from the post down: the post's title (or wordless label), author, date and an excerpt linking to it, then each comment between the post and this one in order, with author, date and content, each linking to its own URL (its page, or a webmention or fediverse reply's own URL). The chain is marked up as nested h-cite in-reply-to, so a parser reads the same thread a person does
- [x] #9 An ancestor that is pending, spam or trashed is shown as a placeholder saying a comment is no longer shown, with no author or content, and the chain continues past it
- [x] #10 In /comments/feed/, an item that answers another comment names it, for example "{author} replying to {parent author} on {post}"; a top-level comment keeps "{author} on {post}"
- [x] #11 Below the comment, its page shows the replies to it, nested at every depth the way the thread on the post shows them, with the same visibility rules (pending, spam and trashed replies are absent) and each linking to its own URL; a comment with no replies shows none, and the page links back to the full thread on the post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: ConversationReader gains comment(id) -> CommentThread { post, comment (Interaction with its replies threaded beneath it), ancestors: (Interaction | null)[] from the top down, null for one no longer shown }. postConversation's gathering of the written replies is split out so the post thread (rooted at the post) and the comment page (rooted at the comment) thread the same list.
2. A native comment's Interaction.url becomes /comment/{encoded id}/ (commentPageHref); webmention and fediverse replies keep their own URL. The #comment-<id> anchor stays on the post page.
3. Route /comment/{id}/ in web/routes.ts: unknown, non-native or unapproved comment 404s; the post answers as publicDocumentAt/goneDocumentAt/answerable would (404 or 410); noindex meta and X-Robots-Tag.
4. Renderer.renderComment + default theme layouts/comment.njk: the comment as the page's only h-entry, the chain above it as nested u-in-reply-to h-cite (post at the deepest level, printed first), placeholders for hidden ancestors, replies below as nested p-comment h-cite through a comment macro moved to partials/comment.njk and shared with conversation.njk, and a link back to the thread.
5. Feeds: FeedComment links follow Interaction.url; /comments/feed/ names the parent author (replyingTo) from the same reading.
6. Docs: doc-6 and packages/cms/README.md; theme README for the new layout and context.
7. Tests first per AC, then pnpm build/test/typecheck/lint/format:check and curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. ConversationReader.comment(id) (web/conversation.ts) returns CommentThread { post, comment, ancestors }; postConversation's collecting loop is now gather(), and threadOf(said, under) threads the same list from the post or from one comment, so the comment page's replies follow the thread's rules. The NOTHING short-circuit was removed: an empty gather yields the same zero conversation.

A native comment's Interaction.url is commentPageHref(id) = /comment/{encodeURIComponent(id)}/ (ids imported from WordPress are URLs, covered by a test). Route in web/routes.ts at COMMENT_PAGE_PREFIX + ':id/': 404 for unknown, pending, spam, deleted, webmention or fediverse ids; 410 when the post is in the trash; 404 when the post is not served or not answerable; noindex meta and X-Robots-Tag. Renderer.renderComment + themes/default/layouts/comment.njk; the comment macro moved to partials/comment.njk with a classes argument (h-entry under a post, p-comment h-cite on a comment page). /comments/feed/ titles name the parent author through SiteInteraction.replyingTo / FeedComment.replyingTo.

Validation: src/web/comment-page.test.ts (23 tests, written first and all failing before the code) covers AC 1-5, 7-11 with microformats-parser; existing URL assertions updated in conversation.test.ts, conversation-markup.test.ts and comments/site.test.ts. pnpm build, test (cms 5209 pass), typecheck, lint and format:check all pass. Curled a scratch site: /comment/{id}/ 200 with x-robots-tag noindex, pending 404, the thread above a reply under a pending comment shows the placeholder, post thread links /comment/{id}/ with the #comment- anchor kept, both comments feeds link the pages, /comments/feed/ titles 'Cal replying to Ada on Hello, world', sitemap and /feed/ carry no /comment/.

Flagged, not changed: an approved reply under a pending or spam comment is left out of the post's thread and its own feed (threadOf drops it, as before this task) but is in /comments/feed/ (siteConversation lists every approved comment) and now has a page whose 'whole conversation' link points at an anchor the post does not print. Pre-existing inconsistency between the thread and latest(); worth a follow-up decision on whether such replies should surface in the thread.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A native comment now has its own page at /comment/{id}/, which is its URL in the thread and both comments feeds; the #comment-<id> anchor stays. The page is the comment as the only h-entry, the thread above it as nested u-in-reply-to h-cite from the post down (placeholders for hidden ancestors), and its replies below as nested p-comment h-cite, with a link back to the thread. It answers as the post would (404/410), is noindex, and is on no list. /comments/feed/ names the comment a reply answers. Read through ConversationReader.comment(id), sharing the gathering and threading with the post's thread. Verified with src/web/comment-page.test.ts (mf2-parsed), the full gate, and curl against a scratch site. doc-6, the CMS README and the theme README describe it.
<!-- SECTION:FINAL_SUMMARY:END -->
