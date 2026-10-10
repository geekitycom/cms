---
id: TASK-326
title: >-
  Every signed-in reply is a reply post: the moderation screen, the editor and
  the reply context follow TASK-300
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 14:37'
updated_date: '2026-10-10 15:35'
labels:
  - comments
dependencies:
  - TASK-300
references:
  - packages/cms/src/comments/reply-post.ts
  - packages/cms/src/webmention/reply-contexts.ts
priority: medium
type: enhancement
ordinal: 285800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gaps left by TASK-300 (decision-47), which made a signed-in user's reply from the thread a reply post:
- A reply written on the moderation screen (/admin/comments) is still stored as a native comment, so the same person's replies take two shapes depending on where they wrote them.
- A reply post written in the editor or over Micropub that answers a native comment sends the commenter no reply notice email; only the thread form does.
- A top-level reply post's in-reply-to is its own site's post permalink, which is still fetched over HTTP for its reply context; held replies already read from the index.
- The reply post's page says "In reply to a post by Ann" when it cites a comment; the theme labels any untitled context "a post".
- In the thread, a reply post's author link carries rel="nofollow ugc", which is for strangers' links, not the site's own users.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reply from the moderation screen is a reply post with the same in-reply-to, visibility default (unlisted) and inline display as one from the thread; existing owner comments are left as they are
- [x] #2 A reply post answering a native comment whose writer asked for email sends the reply notice once, whether it was written in the thread, on the moderation screen, in the editor or over Micropub, and not again when the post is edited
- [x] #3 A reply post whose in-reply-to is a post or page on this site takes its reply context from the index, with no HTTP fetch of the site's own page
- [x] #4 A reply post citing a comment says "In reply to a comment by <name>"; citing a post or page it keeps today's wording
- [x] #5 A reply post's author link in a thread carries no nofollow or ugc; visitor, webmention and fediverse author links keep them
- [x] #6 doc-6 Native Comments describes the moderation-screen reply
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shapes:
- ConversationReader.replyAt(url) becomes heldAt(url): HeldAt, a union of { kind: 'reply', post, reply: Interaction } (what replyAt returned) and { kind: 'document', post, author } for a served post or page named by its permalink or object id. heldReplyContext maps either to a ReplyContext: a document gives its title as name, an excerpt of its html, its author and date; a reply gives what it did, plus comment: true when it is not a reply post. So an own-site in-reply-to is never fetched (AC#3).
- ReplyContext/CitedPage gain comment?: true. citedPageName and the theme's cited-page macro say 'a comment' for it before 'a post' (AC#4).
- reply-post.ts splits into writeReplyPost(site, { document, answered, body, listed }) (the one write: blankForm + writeDocument, unlisted unless listed) and submitReplyPost (form checks + throttle, then writeReplyPost). answeredAt takes anything with source/id/url, so a stored PostComment works too. The notices option and replyNotice leave it.
- New comments/reply-notices.ts: createReplyNotices({ admin, store, conversation, notices, config }).handle(change), subscribed to content changes in index.ts. Tells the commenter (CommentNotices.replyApproved, PostComment-shaped from the reply post and its user) when a change makes a reply post served that was not served before (origin not scan), its in-reply-to resolves through heldAt to a native comment, and the ledger key reply-notice:{comment id}:{permalink} in admin state is unset; it sets it first. Edits, restarts, re-syncs, trash/restore and republish therefore send nothing more (AC#2).
1. Admin moderation reply (admin/comments.ts COMMENTS_REPLY_PATH) calls writeReplyPost with the parent stored comment, the post from its slug, writer = the signed-in user; the form gains the 'Include in posts and feeds' checkbox, unchecked = unlisted (AC#1). intakeComment's moderator origin stays for existing callers only if still used; delete if not.
2. Theme partials/comment.njk (and comment page ancestors): rel nofollow ugc only when source is not post (AC#5).
3. doc-6 and README/theme README updates (AC#6).
Tests first: comments/reply-notices.test.ts (thread, moderation, editor, Micropub, edit, trash/restore, restart = one email), admin/comments.test.ts moderation reply is a reply post, reply-posts.test.ts for AC#3 (no fetch of own page, stubbed fetch), AC#4 wording, AC#5 rel.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, with two changes: intakeComment's moderator origin stays (submitComment's exported author option still uses it), and documentSite(c, writer) in admin/documents.ts now builds the DocumentSite for the editor, the thread form and the moderation screen (Micropub keeps its own, its Context type is BearerEnv).

Shapes: ConversationReader.replyAt is now heldAt(url): HeldAt = { kind: 'reply', post, reply } | { kind: 'document', post, author }, served documents only. heldReplyContext(target, held) maps either; a held reply that is not a reply post gets comment: true, which citedPageName and partials/cited-page.njk print as 'a comment'. writeReplyPost(site, { document, answered, body, listed }) in comments/reply-post.ts is the one write; submitReplyPost lost its viewer and notices options. comments/reply-notices.ts createReplyNotices().handle(change) is subscribed to content changes in index.ts: not on a scan, only when the change makes the reply post served from not served, only when heldAt(in-reply-to) is a native comment, and once per admin state key reply-notice:{comment id}:{permalink}, set before the message goes.

Choices: a moderation reply is written as the signed-in user (it used to be signed with the site author setting), and the Reply box gained the 'Include in posts and feeds' checkbox. A reply post citing another reply post, or a reply post citing its own site's post by permalink, now also reads from the index (kind 'document'); before, a reply post cited by permalink was fetched. A reply to a comment still pending sends no notice, since heldAt only resolves visible replies; the reply post threads under its placeholder. The comment page's ancestor links follow the same rel rule as the thread.

Verified: new src/comments/reply-post-paths.test.ts (14 tests: AC1 moderation reply post, unlisted by default, public when ticked, box offered unticked; AC2 one email each from thread, moderation, editor and Micropub, none after edit, trash and undelete, restart, a pre-existing file edited, or notify false; AC3 no host lookup and the context from the index; AC4 'a comment by Ann'; AC5 rel). Defect checks: removing the ledger fails the trash/undelete test; removing the transition rule fails the pre-existing-file test. admin/comments.test.ts moderation reply test updated to the reply post. pnpm build, typecheck, lint, format:check pass; pnpm test: cms 5287/5287, all packages green (no migrated-site timeout this run). Scratch site on :3917: POST /admin/comments/reply wrote posts/2026-10-10-thanks-ann-from-the-queue.md (in-reply-to /comment/{id}/, visibility unlisted, author ada), shown under Ann in the thread with an author link without rel while Ann's keeps nofollow ugc; its page says 'In reply to a comment by Ann'; absent from /feed/, present in the post comments feed; a top-level reply file cites 'Hello world' with 'Words.' and no reply-contexts.json was written, so nothing was fetched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every signed-in reply is now a reply post. The moderation screen's Reply box writes one through writeReplyPost, the same write the thread form uses, with the same in-reply-to, an 'Include in posts and feeds' box (unchecked = unlisted) and inline display. The reply notice moved off the thread form onto an index subscriber (comments/reply-notices.ts), so a reply post answering a native comment tells its writer once whatever wrote it (thread, moderation, editor, Micropub, a file) and never again on edit, trash and restore, republish or restart, guarded by a transition rule and an admin-state ledger. ConversationReader.heldAt resolves own posts and pages as well as replies, so a reply post's context for this site is read from the index with no HTTP fetch, and a cited comment reads 'In reply to a comment by <name>'. A reply post's author link in a thread drops nofollow ugc. doc-6, the CMS README and the theme README describe it. Verified by src/comments/reply-post-paths.test.ts with defect checks, the full workspace suite, typecheck, lint, format:check, build, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
