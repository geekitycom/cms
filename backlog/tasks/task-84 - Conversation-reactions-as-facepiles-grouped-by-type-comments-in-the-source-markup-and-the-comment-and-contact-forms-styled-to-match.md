---
id: TASK-84
title: >-
  Conversation: reactions as facepiles grouped by type, comments in the source
  markup, and the comment and contact forms styled to match
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:37'
updated_date: '2026-09-13 18:58'
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
- [x] #1 A post with likes, boosts or mentions renders .reactions-section with one .reaction-group per kind present carrying p-like, p-repost or p-mention, an h2.reaction-title with label and count, and a .facepile of a.u-url entries with a round u-photo or an emoji .reaction-icon plus .reaction-name
- [x] #2 Replies render as #comments.comments-area with the counted .comments-title, ol.comment-list of li.h-entry with .comment-author.p-author.h-card, .comment-metadata a.u-url time.dt-published, .comment-content.e-content and nested ol.children; a comment made on this site keeps its Reply link and a fediverse or webmention reply does not
- [x] #3 A post that has comments and is no longer taking them prints p.no-comments; one with none and closed prints nothing
- [x] #4 The comment form and the contact form keep every field, hidden input and error slot they have and take the source form styling; every existing comment, webmention and contact form test passes
- [x] #5 The stylesheet gains the comments and reactions rules from the source; the theme README sections on the conversation and the comment form are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write a failing test file, src/web/conversation-markup.test.ts, that asks one post over HTTP and asserts the source design's markup: .reactions-section with a .reaction-group per kind (p-like, p-repost, p-mention), h2.reaction-title of 'Likes (2)', a .facepile of a.u-url with a 32px u-photo or a .reaction-icon plus .reaction-name; #comments.comments-area with the counted .comments-title, ol.comment-list of li.comment.h-entry holding article.comment-body > footer.comment-meta > .comment-author.vcard.p-author.h-card and .comment-metadata a.u-url time.dt-published, .comment-content.e-content, div.reply only on a source == comment reply, and nested ol.children; p.no-comments on a closed post that has replies and nothing on a closed post with none; the comment form as #respond.comment-respond and the contact form sharing it, both keeping every field, hidden input, honeypot and error slot.
2. Rewrite partials/conversation.njk to that markup: a facepile macro over likes, boosts and mentions in place of the details/summary groups, and the comment macro as the source's comment callback. 'Comments are closed.' is printed when there are replies and no commentForm on the context — the absence of the form is what the context already says about a closed post, so no new key is added.
3. Reclass partials/comment-form.njk as #respond.comment-respond with an h2.comment-reply-title and a p.form-submit, keeping every field, hidden input, honeypot, reply-to box, notify box and error slot; give partials/contact-form.njk the same comment-respond wrapper so the two share one set of rules.
4. Replace the carried-over conversation and form block in themes/default/static/style.css with the source's .comments-area, .comments-title, .comment-list, .comment-list .children, .comment-body, .comment-author, .comment-metadata, .comment-content, .reply, .comment-awaiting-moderation, .no-comments, .comment-respond, .comment-navigation, .reactions-section, .reaction-group, .reaction-title, .facepile and .reaction-icon rules on the theme's tokens, keeping the honeypot rule; no new colour token.
5. Update the tests that pin the old markup — ol.comment-replies in comments/site.test.ts, web/site.test.ts and admin/comments.test.ts, and the counts-behind-a-details assertion in web/site.test.ts — and update the theme README's conversation, comment form and contact form sections.
6. Verify with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first: src/web/conversation-markup.test.ts asks a site over HTTP for four documents — an open post with a native comment, an answer to it, a fediverse reply, a webmention mention, two likes and a boost; a closed post with one comment; a closed post with only a like; and a page with a contact form — and asserts the markup a reader and a microformats parser get. 16 tests, all passing.

partials/conversation.njk is now the source design's markup. Three macros: face(item, icon, href) is one entry of a facepile — a linked round u-photo, or the emoji badge of its kind and a .reaction-name where the site knows no picture; group(items, label, kind, icon, source) is a div.reaction-group carrying p-like, p-repost or p-mention with an h2.reaction-title of 'Likes (2)' and a div.facepile; comment(reply) is the source's comment callback, li.comment.h-entry > article.comment-body > footer.comment-meta with .comment-author.vcard.p-author.h-card and .comment-metadata a.u-url time.dt-published, then .comment-content.e-content, the Reply link in div.reply, and answers in ol.children. The details/summary groups are gone. Likes and boosts link to the person, a mention to the page it came from, which is what the old partial did and what makes a mention worth clicking.

Closed comments: no new context key. The absence of commentForm is already what a closed post looks like — commentFormFor() returns undefined when the site switch, the closing window or the post's own front matter says so — so the partial prints p.no-comments under a thread when there is no form. A boolean would have been a second spelling of the same fact on the public context, and one a site replacing the partial would have to be told about; this is documented in the README under 'The conversation' instead.

The two forms: partials/comment-form.njk is section#respond.comment-respond with h2.comment-reply-title and p.form-submit, and partials/contact-form.njk is section#contact.comment-respond.contact-form, so the stylesheet styles every label, field and button of both through one set of rules. Every field, hidden input, honeypot, reply-to, notify box and error slot is untouched.

The stylesheet: the block commented as carried over until TASK-84 is gone. The conversation and form rules are replaced by the source's .reactions-section, .reaction-group, .reaction-title, .facepile (with :has(.reaction-name) for the badge line), .reaction-icon, .comments-area, .comments-title, .comment-list, .comment-list .children, .comment-body, .comment-author, .comment-metadata, .comment-content, .reply, .no-comments and .comment-respond rules on the theme's tokens, and the media query nests .comment-list .children at spacing-4. No new colour token, so src/web/theme-colors.test.ts is untouched. Two deviations from the source, both deliberate: .facepile a:hover keeps the primary colour rather than only clearing the background, because the source rule leaves a named reaction paper-on-paper on hover; and .comment-awaiting-moderation and .comment-navigation are not ported, because nothing in this CMS renders an unapproved comment on a page or paginates a thread, so both would be rules for markup that cannot exist.

Tests that pinned the old markup were updated with it: ol.comment-replies to ol.children in comments/site.test.ts, admin/comments.test.ts and web/site.test.ts; class="conversation" to the comments area in comments/site.test.ts; and web/site.test.ts's '2 likes' behind a <details> to 'Likes (2)' in a facepile. apps/demo/themes/demo/static/style.css needed nothing: it has never styled .comment* or .contact* — git log -S confirms — so the demo's conversation was unstyled before this change and is unstyled after it.

Validation: pnpm build, pnpm test (1843 + 27 pass, 0 fail), pnpm test:11ty (16 + 5 pass), pnpm typecheck, pnpm lint and pnpm format:check all clean, and the rendered post was read back out of a booted CMS to check the markup by eye.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The conversation and the two forms are the andrewshell.org design's markup. Reactions are a div.reactions-section of one div.reaction-group per kind present — p-like, p-repost, p-mention — each an h2.reaction-title of the label and the count over a div.facepile of a.u-url faces, a round u-photo or an emoji .reaction-icon with the .reaction-name; the details/summary groups are gone. Replies are div#comments.comments-area with a counted comments-title, an ol.comment-list of li.comment.h-entry holding article.comment-body, footer.comment-meta with the author h-card and the permalink around a dt-published time, div.comment-content.e-content, the Reply link in div.reply on comments left here, and answers in ol.children; a post that still has comments and has stopped taking them prints p.no-comments, which the partial reads off the absence of commentForm rather than a new context key. The comment form is section#respond.comment-respond and the contact form wears the same class, so one set of rules styles both, and every field, hidden input, honeypot and error slot is unchanged. The stylesheet's carried-over block is gone, replaced by the source's comments, reactions and form rules on the theme's tokens, and the theme README's conversation, comment form and contact form sections say all of it. Verified by a new src/web/conversation-markup.test.ts of 16 HTTP tests against the packaged theme, by the updated comment, webmention and contact tests, and by pnpm build, test, test:11ty, typecheck, lint and format:check all passing.
<!-- SECTION:FINAL_SUMMARY:END -->
