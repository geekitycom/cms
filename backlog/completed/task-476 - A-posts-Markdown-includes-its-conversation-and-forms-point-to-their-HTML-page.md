---
id: TASK-476
title: >-
  A post's Markdown includes its conversation, and forms point to their HTML
  page
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 00:52'
labels:
  - markdown
  - public-site
  - comments
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/themes/default/partials/conversation.njk
  - packages/cms/themes/default/partials/contact-form.njk
  - packages/cms/themes/default/partials/comment-form.njk
ordinal: 401800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The HTML of a post or page shows its conversation: approved comments, webmentions and fediverse replies threaded, and likes and boosts. Its Markdown has none of it. The contact page's Markdown ends at the prose and gives no way to reach the form, and a post that takes comments says nothing about how to leave one. The Markdown should list the conversation from the same data conversation.njk draws, and say where the contact and comment forms are, linking their HTML page, since a form needs HTML.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post or page's Markdown lists its approved replies (comments, webmentions and fediverse replies) with author, date, link and text, threaded as the HTML threads them
- [x] #2 Likes and boosts appear as the HTML shows them
- [x] #3 Nothing the HTML hides (pending, spam, trashed) reaches the Markdown
- [x] #4 A contact page and a post that takes comments say where their form is and link the HTML page
- [x] #5 The data is on the Markdown partial context, documented, and tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. web/markdown-conversation.ts: markdownConversation(conversation) turns the Conversation the HTML draws into Markdown data: replies threaded with key, source, author {label,url}, url, published, rsvp and text (sanitised HTML converted with the turndown converter); withheld placeholders; likes, boosts, mentions and rsvps as people {label,url} linked as the facepiles link them; counts.
2. render.ts: markdownConversationContext(document, url) reads options.conversation (the same reader as conversation.njk, so moderation filtering is shared), options.commentForm as a stranger and options.contactForm, and adds conversation, commentForm {url: absolute HTML page #respond}, contactForm {url: #contact} and webmention to the Markdown partial context. Adds a nest(width) filter to the Markdown environment.
3. Move micropub/content.ts (HTML to Markdown) to content/html-to-markdown.ts so web/ may import it without crossing the layer map.
4. markdown-footer.md.njk: after More posts and before Feeds, RSVP groups, Likes, Boosts, Mentions (each headed with a count), the counted replies as a nested list, Comments are closed with no form, then Leave a comment and Send a message linking the HTML page.
5. Caching: document Markdown loses Last-Modified, as the HTML did in TASK-181; its ETag is its bytes, so a new reply changes it.
6. Tests: web/conversation-markdown.test.ts; negotiation tests updated for Last-Modified; golden regenerated.
7. Docs: docs/theme/markdown.md, docs/public-site.md, docs/theme/conversation.md, comment-form.md, contact-form.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: the Markdown partial context gets conversation (from the same ConversationReader the HTML uses, converted by web/markdown-conversation.ts), commentForm/contactForm as { url } of the HTML page's form anchor (absolute, not through markdownUrl, which would turn it into the .md), and webmention. The default footer writes reactions, the threaded replies, Comments are closed, Leave a comment and Send a message between More posts and Feeds. A nest filter indents nested replies without putting spaces on blank lines.
Decisions: reply text is the sanitised HTML converted to Markdown with the turndown converter Micropub already uses, moved from micropub/content.ts to content/html-to-markdown.ts because web/ may not import micropub/ (layer-boundary test). Escaped plain text is the fallback when the converter refuses.
Caching: the Markdown ETag was already its bytes, so a new reply changes it. It also carried Last-Modified from the file, so a client sending only If-Modified-Since would get a stale 304 after a new reply; the Markdown now carries no Last-Modified, as the HTML has not since TASK-181. JSON keeps it. negotiation.test.ts updated; the golden file changed for the hello-world .md (Leave a comment section, new ETag, no Last-Modified).
Validation: pnpm build, pnpm test, pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Scratch site (port 3472) with a comments file on /2026/09/the-theme-is-just-templates/: the .md shows 2 replies threaded, no pending comment, Comments are closed as the HTML does; /contact/index.md shows Send a message linking http://localhost:3472/contact/#contact; after adding an approved comment and restarting, If-None-Match with the old ETag plus a future If-Modified-Since answered 200 with a new ETag, no Last-Modified, and 3 replies. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's and a page's Markdown now include the conversation the HTML shows: RSVP groups, likes, boosts and mentions as linked lists with counts, and the replies (comments, webmentions, fediverse replies, reply posts) as a nested list with author, date link, source and their words as Markdown, threaded as the HTML threads them, with placeholders for hidden comments that have visible replies. The data comes from the same ConversationReader as conversation.njk, so pending, spam, deleted and withdrawn items never appear. A post taking comments gets a Leave a comment section, a contact page a Send a message section, each linking the form's anchor on the HTML page. The data is on the Markdown partial context (conversation, commentForm, contactForm, webmention, plus a nest filter) and documented in docs/theme/markdown.md. The Markdown now carries no Last-Modified, like the HTML, so a new reply can never be answered with a stale 304. Verified with web/conversation-markdown.test.ts over HTTP, the full test, typecheck, lint and format runs, and curl against the scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
