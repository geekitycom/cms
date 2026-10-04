---
id: TASK-222
title: 'Quill: accept everything its note, article and media flows send'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 19:43'
updated_date: '2026-10-03 00:19'
labels:
  - micropub
  - interop
dependencies: []
priority: high
type: feature
ordinal: 236800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quill is maintained and does modern IndieAuth with PKCE, so the site supports it as a peer (TASK-219). TASK-219's 'Quill inventory' notes list what Quill sends, read from its source (aaronpk/Quill 691cee2). Its token-in-header-and-body behaviour is fixed separately (PR #95). This task closes the remaining gaps in the flows a Quill user hits: notes, articles, photos and the media endpoint. Location, rsvp, code posts and Quill's event, review, itinerary, exercise and weight editors need a data-model decision first and are out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A create or update with slug or syndicate-to is treated as mp-slug and mp-syndicate-to, as Quill accounts created before its migrations 0002 and 0004 send them
- [x] #2 GET q=source on the media endpoint answers {items: [{url, published}]} with the token user's last upload, newest first, honouring limit, and {items: []} when there is none; micropub-media.json records the upload time and media.ts's docstring no longer says Quill uses q=last
- [x] #3 A create or update with p3k-content-type text/plain or text/markdown is accepted and stores the content as it does without it; any other value, including code/*, is refused with a message naming the type; decision-27 records the amendment
- [x] #4 A create or update with visibility=public is accepted and changes nothing; q=config advertises visibility: ["public"] (unlisted is added when TASK-219's unlisted visibility is built); unlisted and private are refused with a message saying the site does not publish them yet or at all
- [x] #5 A Quill account choosing the legacy 'post' scope at sign-in is granted create (and update), or the consent screen says why it cannot be, instead of every create failing insufficient_scope
- [x] #6 Tests replay Quill's real requests for a note, a note with a photo and alt text, an article, a bookmark, a like and a repost (form and JSON, token in both places) and each answers 201
- [x] #7 The README's Micropub section lists Quill as supported and notes that a photo needs alt text on a site that requires it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. create.ts: a LEGACY_NAMES table (slug -> mp-slug, syndicate-to -> mp-syndicate-to) applied to the property names before createForm reads them; update.ts applies the same names to each change, so a legacy name is treated exactly as its mp- name (syndicate-to updatable, slug refused as mp-slug is).
2. create.ts: an UNSTORED table of properties accepted but not written, each with its check: p3k-content-type (text/plain, text/markdown; anything else refused naming the type) and visibility (public; unlisted 'not yet', private 'does not publish'). update.ts lists both in UPDATABLE owning no fields. An update that changes no field and not the draft flag answers 204 without writing, if a test shows the write path would otherwise touch the file.
3. endpoint.ts q=config advertises visibility: ['public'].
4. media.ts: micropub-media.json stores {url, published} per user (a legacy string entry falls back to the file's mtime); GET q=source answers {items:[{url, published}]} honouring limit, {items: []} when none; q=last kept; docstring corrected.
5. indieauth/request.ts: the legacy 'post' scope expands to create and update at parse time, so consent and the stored grant show the real scopes.
6. quill.test.ts replays Quill's micropub_post (form: h=entry, token in header and access_token, x[0] -> x[]; JSON: header only) for note, note with photo+alt, article (form and JSON html), bookmark, like, repost; each 201.
7. Amend decision-27; README Micropub section lists Quill and the alt-text note.
8. pnpm build/test/typecheck/lint/format:check; curl a running demo for q=config, q=source and a Quill-shaped create.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built (2026-10-02):
- create.ts: LEGACY_NAMES (slug -> mp-slug, syndicate-to -> mp-syndicate-to) merged into the property map at the top of createForm; propertyName() exported and applied to each update change in update.ts, so syndicate-to updates and slug is refused exactly as mp-slug is.
- create.ts: UNSTORED, a table of properties accepted but not written, each with its check. p3k-content-type: text/plain and text/markdown pass; anything else (text/html, code/php) refused naming the type. visibility: public passes; unlisted 'does not publish unlisted posts yet', private 'does not publish private posts', anything else 'visibility is public, not X'. UPDATABLE lists both owning no fields. An update with only visibility=public leaves the file byte-identical: the editor write path already skips a no-op save, so no early return was needed.
- endpoint.ts q=config advertises visibility: ['public'].
- media.ts: micropub-media.json stores {url, published} per user (published from store.now()); a legacy bare-string entry is dated by the upload file's mtime so Quill's 15-minute freshness check never offers a stale photo. GET q=source answers {items:[{url, published}]}, honours limit (0 gives [], a non-integer is 400), {items: []} when there is none or the file was deleted. q=last kept for other clients; docstring corrected.
- indieauth/request.ts: LEGACY_SCOPES expands 'post' to create and update at parse time, so the consent screen ticks create and update and the grant stores them.
- activity-log.test.ts used visibility=private as its example refusal; private is still refused, the test now matches the new message.
- decision-27 amended by hand (accepted in this repo); doc-2's Micropub section updated with backlog doc update; README: scope note, token-both-ways sentence corrected (it still said 400 since PR #95), property table rows, update note, q=config visibility, media q=source, Quill supported with the alt-text note.

Validation: pnpm build, pnpm test (3483 pass + 30 eleventy), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Failing-first: quill.test.ts failed with 'does not understand slug, syndicate-to', 'does not understand p3k-content-type', 'does not understand visibility', 'cannot update syndicate-to', config visibility undefined; media q=source failed 'does not answer q=source'; consent test showed 'It asks only who you are' for scope=post. Live: a scratch site on temp dirs (port 3917) answered q=config visibility ['public']; a Quill-shaped form note (token in header and access_token, category[], slug, visibility=public, p3k-content-type=text/markdown) 201 at /2026/10/curl-note/; JSON [{html}] article 201; unlisted and code/php 400 with their messages; an upload then q=source&limit=1 answered {items:[{url, published}]} and micropub-media.json held {url, published}. PHP strtotime parses the published format (checked with php -r). Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Quill's note, article, bookmark, like, repost and last-photo flows now work end to end. Legacy slug and syndicate-to are read as mp-slug and mp-syndicate-to on create and update; p3k-content-type (text/plain, text/markdown) and visibility=public are accepted and change nothing, other values refused by name with their own messages (decision-27 amended, doc-2 updated); q=config advertises visibility: ['public']; the media endpoint answers q=source with {items:[{url, published}]} and records upload times; the legacy 'post' scope is shown and granted as create and update. README lists Quill as supported with the alt-text note. Verified by quill.test.ts replaying Quill's own form and JSON requests, new media and consent tests, the full build/test/typecheck/lint/format run, and curl against a live scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
