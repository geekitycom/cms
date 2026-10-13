---
id: TASK-196
title: Pages show and accept comments like posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-06 01:42'
labels:
  - indieweb
  - webmention
  - theme
milestone: m-28
dependencies: []
references:
  - packages/cms/themes/default/layouts/page.njk
  - packages/cms/themes/default/partials/conversation.njk
priority: low
type: feature
ordinal: 212800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks to receive webmentions and display comments on every post type. Posts show the conversation (replies, likes, reposts, mentions, and fediverse responses), but pages rendered by layouts/page.njk show none, even when a webmention to a page has been received and accepted. Decide with the site owner's comments setting whether pages take part, then render the conversation partial on pages that accept comments, with the same moderation as posts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A page that accepts comments shows its accepted replies, likes, reposts and mentions with the same markup as a post
- [x] #2 A webmention to a page is received, moderated and displayed the same way as one to a post
- [x] #3 A page can turn comments off, and then shows none, as a post can
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add one check to comments/policy.ts that says whether a document takes part in the conversation: every post, and a page only while commentsOpen says it takes comments (site switch on, not a draft, comments: true in its front matter; pages default closed). TASK-203 reuses it to decide where to advertise pingbacks.
2. Gate the renderer's conversation context on that check, so a page that does not take comments gets no conversation however many approved answers it has.
3. Render partials/conversation.njk and partials/comment-form.njk from layouts/page.njk exactly as layouts/post.njk does.
4. Tests first: a page with comments: true shows the same conversation markup as a post with the same answers; a webmention to such a page is held, then shown once approved; a page with comments off (front matter false, default, or site switch off) shows none.
5. Update the theme README and partial header docs, then run build, test, typecheck, lint, format:check and curl a running demo page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: a page takes part in the conversation only while commentsOpen says it takes comments, which means the site switch is on, it is not a draft, and its front matter says comments: true. Pages stay closed by default, as the existing policy and WordPress have them. A post keeps its thread after it closes; a page that turns comments off shows nothing, because a page opts in rather than ages out.

The single check is answerable(document, policy, now) in packages/cms/src/comments/policy.ts: every post, plus a page while commentsOpen holds. TASK-203 should use it to decide where to advertise the pingback endpoint. The renderer (web/render.ts documentPage) leaves conversation off the context when answerable is false. commentForm already followed commentsOpen. layouts/page.njk now includes partials/conversation.njk and partials/comment-form.njk exactly as layouts/post.njk does.

Receiving and moderating webmentions to a page already worked: receive.ts resolves any served document and stores it pending like one to a post. Only display was missing. The native comment POST route also already accepted pages through commentsOpen.

Validation: pnpm build && pnpm test (4630 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. New src/web/page-conversation.test.ts: an open page renders conversation markup byte-identical to a post's with the same answers (after normalising ids and permalinks), it has the form, and comments: false, no key, and site comments: false each show nothing. Removing the gate in render.ts makes those three fail. receive.test.ts: a webmention to an open page answers 202, is held pending and not shown, and shows as comment-webmention once approved.
HTTP check: served a scratch copy of apps/demo/content on port 3197 with now.md set to comments: true and four approved webmentions (reply, like, repost, mention). curl /now/ showed the p-like, p-repost and p-mention groups each counted 1, the One reply thread, and the #respond form. A POST to /_geekity/comments with post=now answered 303 to /now/?comment=pending and was stored pending and not shown. With comments: false the reactions, thread and form were all gone. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pages now take part in the conversation while they take comments. The new answerable() check in comments/policy.ts covers every post, and a page only while commentsOpen holds (comments: true in its front matter and the site switch on). The renderer gates the conversation context on that check, and layouts/page.njk renders the conversation and comment form exactly as post.njk does. A page with comments off, or with no key since pages default closed, or on a site with comments switched off, shows nothing. Webmentions to pages were already received and moderated; they now display. Verified with new page-conversation tests (markup identical to a post's; a mutation check showed the gate tests fail without the gate), a page webmention test in receive.test.ts, the full pnpm build/test/typecheck/lint/format:check run, and curl against a scratch copy of the demo site.
<!-- SECTION:FINAL_SUMMARY:END -->
