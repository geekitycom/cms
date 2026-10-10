---
id: TASK-318
title: A visitor comment has a page of its own that other sites can reply to
status: To Do
assignee: []
created_date: '2026-10-10 12:30'
updated_date: '2026-10-10 12:52'
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

Give each native comment a page of its own, under its post or page, that serves the comment as the page's only h-entry, with u-in-reply-to pointing at the post. The comment's u-url becomes that page. The fragment anchor on the post page stays, so existing links keep scrolling to the comment.

Only native visitor comments need this. A webmention reply's URL is its sender's page and a fediverse reply's URL is the remote Note, and both stay so: clicking their timestamp goes to their site. Replies from signed-in users become reply posts (TASK-300), which have URLs already.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An approved native comment answers 200 at its own URL with an h-entry for the comment alone: author h-card, content, published date, u-url equal to that URL, and u-in-reply-to the post it is on (or the comment it answers)
- [ ] #2 A pending, spam or trashed comment, and the comment page of a draft or unpublished post, answer 404 or 410 as the post itself would
- [ ] #3 The thread on the post page prints the comment's u-url as its own page; the #comment-<id> anchor still exists and still scrolls to it
- [ ] #4 A webmention or fediverse reply keeps its sender's URL as its u-url and gets no page of its own
- [ ] #5 The comment page is noindex and is absent from the sitemap, feeds and search
- [ ] #6 doc-6 Native Comments and the CMS README describe the comment page
- [ ] #7 In the post's comments feed and /comments/feed/, a native comment's item links to its own page rather than the #comment-<id> fragment
<!-- AC:END -->
