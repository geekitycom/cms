---
id: TASK-84
title: >-
  Conversation: reactions as facepiles grouped by type, comments in the source
  markup, and the comment and contact forms styled to match
status: To Do
assignee: []
created_date: '2026-09-13 13:37'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-83
references:
  - packages/cms/themes/default/partials/conversation.njk
  - packages/cms/themes/default/partials/comment-form.njk
  - packages/cms/themes/default/partials/contact-form.njk
  - /Users/andrewshell/code/wordpress/asdo-theme/comments.php
  - /Users/andrewshell/code/wordpress/asdo-theme/functions.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 109800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bring partials/conversation.njk, partials/comment-form.njk and partials/contact-form.njk to the source design (decision-16). Reactions: a div.reactions-section after the entry with one div.reaction-group per kind that has any (likes as p-like, boosts as p-repost, mentions as p-mention), each with an h2.reaction-title of the label and count, Likes (3), and a div.facepile of one a.u-url per actor wrapping a 32px round u-photo avatar, or, without an avatar, a .reaction-icon emoji badge and the .reaction-name; the details/summary groups go. Comments: div#comments.comments-area with an h2.comments-title, One comment on "Title" or N comments on "Title", then ol.comment-list of li.comment.h-entry items each holding article.comment-body with footer.comment-meta > div.comment-author.vcard.p-author.h-card (avatar and b.fn.p-name), div.comment-metadata > a.u-url > time.dt-published, div.comment-content.e-content, and the Reply link in div.reply for a comment made on this site; nested replies in ol.children. Comments are closed prints p.no-comments when the post no longer takes comments but has some. The comment form keeps its fields, honeypot, reply-to and notify box and takes the comment-respond classes and styling; the contact form takes the same form styling. The conversation object and the form contract are unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with likes, boosts or mentions renders .reactions-section with one .reaction-group per kind present carrying p-like, p-repost or p-mention, an h2.reaction-title with label and count, and a .facepile of a.u-url entries with a round u-photo or an emoji .reaction-icon plus .reaction-name
- [ ] #2 Replies render as #comments.comments-area with the counted .comments-title, ol.comment-list of li.h-entry with .comment-author.p-author.h-card, .comment-metadata a.u-url time.dt-published, .comment-content.e-content and nested ol.children; a comment made on this site keeps its Reply link and a fediverse or webmention reply does not
- [ ] #3 A post that has comments and is no longer taking them prints p.no-comments; one with none and closed prints nothing
- [ ] #4 The comment form and the contact form keep every field, hidden input and error slot they have and take the source form styling; every existing comment, webmention and contact form test passes
- [ ] #5 The stylesheet gains the comments and reactions rules from the source; the theme README sections on the conversation and the comment form are updated
<!-- AC:END -->
