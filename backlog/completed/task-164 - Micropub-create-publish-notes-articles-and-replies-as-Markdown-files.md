---
id: TASK-164
title: 'Micropub create: publish notes, articles and replies as Markdown files'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:54'
updated_date: '2026-10-02 15:21'
labels:
  - micropub
  - indieweb
  - content
milestone: m-25
dependencies:
  - TASK-163
references:
  - 'https://www.w3.org/TR/micropub/'
documentation:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
priority: high
type: feature
ordinal: 188800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core of Micropub. A POST with h=entry, form-encoded or JSON, creates a post through the same save path the admin editor uses, so the file, slug, permalink, author, webmentions, federation and feeds all behave as they do for an editor post. The token's user is the author. Properties map onto front matter: name to title, content (plain or {html}) to the body, summary to description, category to tags, in-reply-to, published to date, post-status draft to draft, and mp-slug to the slug. Record the mapping as a decision and add it to doc-2. Properties the site does not understand are refused rather than silently dropped, so the client can say so.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A form-encoded and a JSON create each return 201 with a Location header pointing at the new post's permalink, proven by tests
- [x] #2 The written file is indistinguishable from one the editor would write for the same content, and Post Type Discovery gives it the same type
- [x] #3 The post is authored by the token's user, and publishing it sends webmentions and federates exactly as an editor publish does
- [x] #4 post-status draft writes a draft that is not published, federated or sent webmentions
- [x] #5 A token without the create scope gets 403 insufficient_scope
- [x] #6 Unsupported properties or types (for example like-of before those post types exist) get 400 with a message naming them, and no file is written
- [x] #7 The property mapping is recorded as a decision and in doc-2
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Split the editor's saveFromForm into an HTTP shell and a core, writeDocument(writer, kind, document, form, draft), that takes plain values (store, config, announce, the signed-in username) and returns saved | refused | conflict. The editor keeps its behaviour; Micropub calls the same core with POST_KIND, so the file, slug, permalink, author, announce (webmentions, federation, feeds) are the editor's by construction.
2. Give requireSiteToken a scope: GET keeps any scope, POST requires create (403 insufficient_scope from requireBearer).
3. New src/micropub/create.ts: parse a form-encoded or JSON body into one shape (type + properties as string lists + mp-* commands), refuse anything not h-entry, any property outside the mapping, any value that is not a string (or {html} for content), and a second value for a single-valued property, naming each in a 400 invalid_request. Map name->title, content->body (plain verbatim, {html} verbatim), summary->description, category->tags, in-reply-to, published->date, post-status draft|published->draft, mp-slug->slug into an EditorForm with the token's user as author.
4. POST handler: 201 with Location = absolute permalink; a refusal from the core is 400 invalid_request.
5. Tests first in src/micropub/create.test.ts for each AC: form and JSON 201 + Location; byte-equal to the editor's file for the same content and same PTD type; author + webmention + delivery on publish, none for draft; 403 without create; 400 naming like-of / h=event, no file written.
6. Record the mapping as decision-27 and in doc-2; extend README Micropub section.
7. pnpm build/test/typecheck/lint/format:check, curl the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The editor's saveFromForm is now an HTTP shell over writeDocument(site, write) in src/admin/documents.ts, which takes plain values (store, config, announce, the writing username) and returns saved | refused | conflict. Micropub (src/micropub/create.ts) parses a form, multipart or JSON body into one CreateRequest, maps it onto an EditorForm (blankForm(POST_KIND) with the token's user as author) and calls the same core, so the file, slug, permalink, filing day, author, alt-text rule and announce are the editor's by construction. The announce origin stays 'admin'.
requireSiteToken is now requireSiteToken(scope?): GET keeps any scope, POST needs create.
Refusals are 400 invalid_request whose description names every unsupported type or property (mp-syndicate-to included until TASK-168), a second value for a single-valued property, a non-text value, a category with a comma, or an unknown post-status; the editor's own refusals (in-reply-to not a URL, alt text) come back with the editor's message.
Plain content is kept as Markdown; {html} content is kept as HTML in the body (decision-27 notes that a blank line inside an HTML element may split it).
Recorded decision-27 (body written by hand, the CLI cannot set decision bodies) and a Micropub section in doc-2; README Micropub section extended.
Validation: src/micropub/create.test.ts (18 tests) red with 404 before the route existed; mutations (draft mapped to false, an extra lang) each turn one test red. pnpm build && pnpm test (3264 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. Curl against pnpm start on the demo: form and JSON creates 201 with Location, posts served 200 and stamped activitypub.published, draft 201 and 404 publicly, profile-only token 403 insufficient_scope scope="create", like-of 400 naming it. Test posts and the issued tokens file were removed afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub create: POST /_geekity/micropub with the create scope turns a form-encoded, multipart or JSON h-entry into a post through the admin editor's own write path (writeDocument, split out of saveFromForm), authored by the token's user, and answers 201 with the permalink in Location. name, content (plain or html), summary, category, in-reply-to, published, post-status and mp-slug map onto editor fields; anything else is refused with 400 naming it and writes nothing. Mapping recorded in decision-27, doc-2 and the README. Verified by src/micropub/create.test.ts (byte-equal file to the editor's, PTD type, author, webmention and delivery on publish, none for a draft, 403, 400s), the full gate run, and curl against the running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
