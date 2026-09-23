---
id: TASK-49
title: 'Replies, likes, and boosts shown on the post page'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 21:57'
labels:
  - web
  - federation
  - theme
milestone: m-7
dependencies:
  - TASK-18
  - TASK-39
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The inbox log holds every fediverse reply, like and boost a post receives, and TASK-39 turns replies into feeds, but the HTML page never shows any of it. Render a conversation section under each post from the index: replies as a thread (author name, handle and avatar linking to the remote profile, sanitised content, time, a link to the remote note; nested by `inReplyTo` where a reply answers a reply the site has seen), and likes and boosts as counts with the actors behind them on hover or expand. The section is one template partial the theme may override, with the data handed to it in one documented shape so a theme can restyle it, and it also reaches an Eleventy build through the same data files the inbox log lives in. A deleted remote note (a `Delete` arriving for a reply) drops it. The thread is the shape native comments (next task) and webmentions join, so its data model is a comment with a `source`, not an ActivityPub-specific one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with replies in the inbox log shows them under the post with author, avatar, content, time and a link to the remote note, newest last, nested where a reply answers a reply
- [x] #2 Likes and boosts appear as counts with the actors listed on expand
- [x] #3 Reply content is sanitised and a Delete of a reply removes it from the page
- [x] #4 The section is a theme-overridable partial fed a documented data shape, and a page with no interactions renders no empty section
- [x] #5 An Eleventy build of the same content can render the same replies from the data files
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: add `listActivitiesAbout(objectIds)` to AdminStore — every logged activity naming one of these objects (object_id IN …) or answering one (in_reply_to IN …), oldest first — plus a migration adding the ap_inbox object_id index. Test through openAdminStore.
2. New module packages/cms/src/web/conversation.ts: the source-neutral record (`Interaction`: id, source, kind, author {name, handle, url, avatar}, url, content, published, inReplyTo, status, replies) and `postConversation(context, document)`, which walks the log outwards from the post's ActivityStreams id — replies, replies to replies, likes, boosts, Deletes and Undos — sanitises the remote HTML with the existing sanitizeCommentHtml, and returns { replies (nested, oldest first), likes, boosts, counts }. Test-first over a real CMS.
3. Renderer: a `conversation` provider injected the way `pages` is, put on the post context only when there is something in it, so a page with no interactions renders no section.
4. Theme: partials/conversation.njk, rendered from layouts/post.njk, overridable through the ordinary theme lookup; styles in the packaged stylesheet.
5. Docs: the data shape in themes/default/README.md (where the template context is documented) and a Conversation section in doc-4.
6. Eleventy: a documented recipe in docs/eleventy.config.example.js that builds the same thread from federation.inbox, proved by a test in packages/cms/test (pnpm test:11ty) that builds the fixtures and asserts the reply's content and author reach the page.
7. Verify: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as one source-neutral record rather than an ActivityPub one. `Interaction` (packages/cms/src/web/conversation.ts) is { id, source, kind, author { name, handle, url, avatar, actorId }, url, content, published, inReplyTo, status, replies }; `Conversation` is { replies, likes, boosts, counts { replies, likes, boosts, total } }. It is called `Interaction` rather than `Comment` because a like is one too and because `Comment" is already the exported name of the site-wide comments feed's item; the docs say so. TASK-50 adds source 'native' and a status other than 'published'; TASK-51 adds 'webmention' with kinds 'mention'/'repost'.

The store gained `listActivitiesAbout(objectIds)` — everything naming one of a set of objects, over object_id or in_reply_to, oldest first — plus migration 13, an index on ap_inbox.object_id. `postConversation` walks outwards from the post's object id with it, so nesting, Deletes of a note and Undos of a like all fall out of the same query. A Delete or an Undo counts only from the actor that did the thing (the Undo(Follow) rule); the answers to a deleted reply move up to what it was answering rather than vanishing with it.

Sanitising reuses the repo's own `sanitizeCommentHtml` (src/web/sanitize.ts), which the comments feeds already republish through, so the page and the feed cannot disagree.

The renderer takes a `conversation` provider the way it already takes `pages`, and puts `conversation` on the context only when counts.total > 0, which is what makes an empty section impossible. themes/default/partials/conversation.njk is the section (recursive `comment` macro, `<details>` for the reactions), included from layouts/post.njk and from apps/demo's overriding layout.

For Eleventy, docs/eleventy.config.example.js gained a `conversation` filter over federation.inbox, a preprocessor putting the post's object id on the context as `activityStreams`, and a compact copy of the sanitiser (the file promises no dependencies beyond Eleventy). packages/cms/test/eleventy.test.ts builds the fixtures and checks the reply, its author, its link, the like count and the sanitising.

Validation: pnpm build, pnpm test (1056 + 11 pass, 0 fail), pnpm test:11ty (13 + 5 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all clean from the repo root. AC1 and AC3 are proved by 'the conversation under a post' in packages/cms/src/web/site.test.ts (real HTTP requests through cms.app) and by packages/cms/src/web/conversation.test.ts; AC2 by the likes/boosts test in the same suite; AC4 by the theme-override and no-empty-section tests plus the theme README and doc-4; AC5 by the two new cases in packages/cms/test/eleventy.test.ts, which build the fixture content with the documented Eleventy config.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a source-neutral conversation model and rendered it under every post. packages/cms/src/web/conversation.ts turns the inbox log into a Conversation — replies threaded by inReplyTo, likes and boosts counted per actor, Deletes and Undos honoured only from the actor that did the thing, remote HTML through the existing sanitizeCommentHtml — read through a new AdminStore.listActivitiesAbout and an index on ap_inbox.object_id (migration 13). The renderer puts it on a post's context as `conversation` only when there is something in it, and themes/default/partials/conversation.njk renders it, overridable like any other template. The shape is documented in the theme README ('The conversation') and in doc-4. docs/eleventy.config.example.js builds the same thing from the same data files with a `conversation` filter. Verified with pnpm build, test, test:11ty, typecheck, lint and format:check, all passing, including new HTTP-level tests for the replies, the reaction counts, a deleted reply, an empty post, a theme override, and the Eleventy build.
<!-- SECTION:FINAL_SUMMARY:END -->
