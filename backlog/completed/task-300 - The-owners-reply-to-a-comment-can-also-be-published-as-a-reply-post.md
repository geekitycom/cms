---
id: TASK-300
title: >-
  A signed-in user's reply in a comment thread is a reply post, shown in the
  thread
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 14:39'
updated_date: '2026-10-10 14:34'
labels:
  - comments
  - indieweb
  - federation
dependencies:
  - TASK-318
  - TASK-319
references:
  - packages/cms/src/comments/submission.ts
  - packages/cms/src/comments/form.ts
  - packages/cms/src/comments/signed-in.test.ts
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
priority: medium
type: feature
ordinal: 260800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a signed-in owner's reply to a comment is stored as a local comment. It never leaves the site: no ActivityPub activity and no webmention (comments/submission.ts). The form also only lets you answer a native comment, so a webmention reply or a fediverse reply cannot be answered from the thread at all.

The model from here: a comment is something somebody else says on the site (a visitor through the form, a webmention, a fediverse reply); a post is something a signed-in user says. A signed-in user's reply in a thread is therefore a reply post, one record, whose in-reply-to is what it answers:
- a native comment: the comment's own page (TASK-318);
- a webmention reply: its sender's URL, so the other site gets a webmention back;
- a fediverse reply: the remote Note's id, so it federates into that thread addressed to its author;
- the post itself, for a top-level reply.

The thread shows the reply post inline where the comment would have been, so the reply is never stored or shown twice. The form's checkbox chooses its visibility: checked is Public (homepage or post listing, feeds, outbox); unchecked is Unlisted, which already means its own noindex page, no listing or feed, webmentions still sent, followers still sent the Create (README, Unlisted posts). A reply post written in the editor or over Micropub whose in-reply-to names a comment on this site shows in that thread the same way.

Replies to the reply post land against it (its own URL), so the thread stitches them in under it, rather than splitting the conversation across two pages.

By design, a visitor's reply to a fediverse comment stays a native comment and does not go out over ActivityPub: a visitor is not a user and has no actor. That is accepted.

Existing owner comments stay comments; only new replies become posts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A signed-in user replying from the thread creates a reply post, not a comment, whose in-reply-to is the native comment's page, the webmention reply's sender URL, the fediverse reply's Note id, or the post, by what it answers
- [x] #2 The thread shows that reply post inline under what it answers, once, with its author, content and a u-url to the reply post
- [x] #3 The form shows signed-in users a checkbox labelled "Include in posts and feeds", unchecked by default: checked publishes the reply post as Public, unchecked as Unlisted, and either way it reaches who it answers. Anonymous visitors never see it, and a forged field from them is ignored
- [x] #4 A public reply post appears in the post listing and the RSS, Atom and JSON feeds like any reply post; an unlisted one is absent from them and keeps the unlisted rules
- [x] #5 A reply to a webmention reply sends a webmention to its sender URL; a reply to a fediverse reply federates with inReplyTo the remote Note id and is addressed to its author
- [x] #6 Every comment, including webmention and fediverse replies, shows signed-in users a Reply link; visitors keep a Reply link on native comments only
- [x] #7 A reply post made in the editor or over Micropub whose in-reply-to names a comment on this site shows inline in that thread the same way, and its reply context is the comment, not the whole post page
- [x] #8 A webmention or fediverse reply to the reply post threads under it in the original thread
- [x] #9 A visitor's reply under a fediverse comment stays a native comment and sends nothing over ActivityPub; existing owner comments are left as comments
- [x] #10 doc-6 Native Comments and the CMS README describe the model, and a decision records it
- [x] #11 A reply post shown in a thread, Public or Unlisted, appears once in that post's comments feed and in /comments/feed/, linking to the reply post; the unlisted rule that keeps an unlisted post out of feeds does not remove it from comment feeds
- [x] #12 A reply post in the site's RSS feeds carries source:inReplyTo holding its in-reply-to target (a comment page, a sender URL, a Note id or a post), so a feed reader can see what it answers
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: InteractionSource gains 'post'. A reply post in a thread is an Interaction { source: 'post', id: its object id, url: its permalink, author: its user, content: its html, inReplyTo: the reply id its in-reply-to names }. It comes out of gather() like every other source, so the thread, comment pages, counts and both comments feeds get it.

1. Content index: listRepliesTo(targets) for served posts whose in_reply_to is one of these URLs, and listReplyPosts(options) for served reply posts, newest first. Add an index on in_reply_to. Admin index: listCommentsAt(url) for webmention comments by their url.
2. conversation.ts: gather() names every entry by the URLs a reply post can use: the post's permalink and object id, a comment's page and #comment- anchor, a webmention's url, a fediverse reply's id and url. It asks the index for served reply posts answering any of those. Each one joins written with inReplyTo resolved, and its own gather is merged in, with its top-level answers set to the reply post's id. Replies to the reply post therefore thread under it. A seen set ends cycles. latest() adds reply posts, found through threadRootOf (in-reply-to -> document, walked up). counts() adds reply posts answering the post or one of its stored comments or direct fediverse replies. New replyAt(url) resolves a URL to a visible reply on this site.
3. Reply contexts: the service takes a local(target) resolver built from conversation.replyAt. read/describe answer from it. handle and catchUp never fetch a target it resolves.
4. Comment form: the signed-in path builds an EditorForm (blankForm + body + in-reply-to + visibility). It saves through writeDocument, the editor/Micropub write path, so federation, webmentions and reply contexts follow from the announce. Its in-reply-to is resolved from the thread: comment page, sender URL, Note id, a reply post's permalink, or the post. The listed checkbox ('Include in posts and feeds', unchecked = unlisted) is read only for a signed-in user. A native parent who asked for email is still told. The anonymous path is unchanged.
5. Template: a Reply link on every reply for signed-in users, native only for visitors. commentReplyTarget resolves any visible reply for a signed-in viewer. A reply post's u-url is not nofollow.
6. RSS: source:inReplyTo on a reply item.
7. Docs: README (comments, unlisted table, RSS), default theme README, doc-6, and a decision.
Tests first per AC: comments/reply-posts.test.ts (HTTP, signed-in), conversation unit tests, a delivery test for the fediverse case, a webmention send test, and a feed test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Reused path: comments/reply-post.ts submitReplyPost builds an EditorForm from blankForm(POST_KIND) with body, in-reply-to and visibility and saves it through admin/documents.ts writeDocument, the write path the editor and Micropub create share (micropub/endpoint.ts ACTIONS.create calls the same function with the same DocumentSite). So federation (delivery.handle), webmentions (webmentions.handle) and reply contexts (replyContexts.handle) all follow from the announce, with nothing new on that side.

Model: conversation.ts InteractionSource gains 'post'. gather() names every entry by the URLs a reply post can use (namesIn/namesOf). It asks ContentStore.listRepliesTo(urls) for served reply posts, unlisted included, and merges each one's own gather with its top-level answers set to the reply post's object id. A seen set of paths ends cycles. latest() reads ContentStore.listReplyPosts and walks each up with threadRootOf/documentNamed. counts() adds reply posts answering the post, its stored comments or its direct notes. replyAt(url) feeds the reply-context service's new held option, so a target this site holds is read from the index and never fetched. Store migration 9 indexes in_reply_to. AdminStore.listCommentsAt(url) finds a webmention by its sender page.

Form: COMMENT_FIELDS.listed ('Include in posts and feeds'), read only on the signed-in path. A native parent who asked for reply email is still told: a PostComment-shaped notice is built from the reply post. CommentViewer gains username. commentReplyTarget takes the thread for a signed-in viewer. RSS items carry source:inReplyTo.

Left as is: submitComment keeps its exported author (SignedInAuthor) option, though the thread form no longer uses it, because removing it breaks the package API. The moderation screen's reply is still a comment. A reply post written in the editor or Micropub answering a comment sends no reply email. On a boot scan, a reply post file whose target comment's post is not indexed yet can have that target fetched once. read() still answers from the comment. Comments feed items carry no source:inReplyTo yet (TASK-324).

Verified: comments/reply-posts.test.ts (21 tests, AC 1-4, 6-9, 11, 12), federation/delivery.test.ts TASK-300 (AC 5 fediverse, stubbed peer, unlisted default), webmention/send.test.ts TASK-300 (AC 5 webmention), web/conversation.test.ts TASK-300 (counts, cycle, latest). Also curled a scratch site on :3300: signed-in reply to a native comment wrote an unlisted reply post with in-reply-to /comment/{id}/, shown under the comment on the thread and the comment page, in the post comments feed and /comments/feed/ ('ada replying to Ann on Hello world'), absent from /feed/, reply context quoting Ann. A listed reply to a webmention appeared on / and in /feed/ with source:inReplyTo the sender URL. pnpm --filter @geekity/cms test 5254/5254, typecheck, lint, format:check and build clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A signed-in user's reply in a thread is now a reply post, one record, shown inline under what it answers. The form saves it through writeDocument, the path the editor and Micropub share, so it federates, sends webmentions and fetches reply contexts like any reply post. Its in-reply-to is the comment's page, the webmention sender's page, the note id or the post. 'Include in posts and feeds' (unchecked = unlisted) picks its visibility. ConversationReader.gather() finds reply posts by in-reply-to (ContentStore.listRepliesTo) and merges what was said under each. The thread, comment pages, counts and both comments feeds therefore show them, and answers to a reply post thread under it. Signed-in users get Reply on every entry. A reply post citing a held reply takes its context from the index through replyAt. RSS reply items carry source:inReplyTo. Docs: README, theme README, doc-6, decision-47. Verified by comments/reply-posts.test.ts plus TASK-300 tests in delivery, webmention send and conversation, the full workspace pnpm test (cms 5254/5254), typecheck, lint, format:check and build, and by curling a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
