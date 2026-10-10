---
id: TASK-300
title: >-
  A signed-in user's reply in a comment thread is a reply post, shown in the
  thread
status: To Do
assignee: []
created_date: '2026-10-08 14:39'
updated_date: '2026-10-10 13:14'
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
- [ ] #1 A signed-in user replying from the thread creates a reply post, not a comment, whose in-reply-to is the native comment's page, the webmention reply's sender URL, the fediverse reply's Note id, or the post, by what it answers
- [ ] #2 The thread shows that reply post inline under what it answers, once, with its author, content and a u-url to the reply post
- [ ] #3 The form shows signed-in users a checkbox labelled "Include in posts and feeds", unchecked by default: checked publishes the reply post as Public, unchecked as Unlisted, and either way it reaches who it answers. Anonymous visitors never see it, and a forged field from them is ignored
- [ ] #4 A public reply post appears in the post listing and the RSS, Atom and JSON feeds like any reply post; an unlisted one is absent from them and keeps the unlisted rules
- [ ] #5 A reply to a webmention reply sends a webmention to its sender URL; a reply to a fediverse reply federates with inReplyTo the remote Note id and is addressed to its author
- [ ] #6 Every comment, including webmention and fediverse replies, shows signed-in users a Reply link; visitors keep a Reply link on native comments only
- [ ] #7 A reply post made in the editor or over Micropub whose in-reply-to names a comment on this site shows inline in that thread the same way, and its reply context is the comment, not the whole post page
- [ ] #8 A webmention or fediverse reply to the reply post threads under it in the original thread
- [ ] #9 A visitor's reply under a fediverse comment stays a native comment and sends nothing over ActivityPub; existing owner comments are left as comments
- [ ] #10 doc-6 Native Comments and the CMS README describe the model, and a decision records it
- [ ] #11 A reply post shown in a thread, Public or Unlisted, appears once in that post's comments feed and in /comments/feed/, linking to the reply post; the unlisted rule that keeps an unlisted post out of feeds does not remove it from comment feeds
- [ ] #12 A reply post in the site's RSS feeds carries source:inReplyTo holding its in-reply-to target (a comment page, a sender URL, a Note id or a post), so a feed reader can see what it answers
<!-- AC:END -->
