---
id: TASK-222
title: 'Quill: accept everything its note, article and media flows send'
status: To Do
assignee: []
created_date: '2026-10-02 19:43'
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
- [ ] #1 A create or update with slug or syndicate-to is treated as mp-slug and mp-syndicate-to, as Quill accounts created before its migrations 0002 and 0004 send them
- [ ] #2 GET q=source on the media endpoint answers {items: [{url, published}]} with the token user's last upload, newest first, honouring limit, and {items: []} when there is none; micropub-media.json records the upload time and media.ts's docstring no longer says Quill uses q=last
- [ ] #3 A create or update with p3k-content-type text/plain or text/markdown is accepted and stores the content as it does without it; any other value, including code/*, is refused with a message naming the type; decision-27 records the amendment
- [ ] #4 A create or update with visibility=public is accepted and changes nothing; q=config advertises visibility: ["public"] (unlisted is added when TASK-219's unlisted visibility is built); unlisted and private are refused with a message saying the site does not publish them yet or at all
- [ ] #5 A Quill account choosing the legacy 'post' scope at sign-in is granted create (and update), or the consent screen says why it cannot be, instead of every create failing insufficient_scope
- [ ] #6 Tests replay Quill's real requests for a note, a note with a photo and alt text, an article, a bookmark, a like and a repost (form and JSON, token in both places) and each answers 201
- [ ] #7 The README's Micropub section lists Quill as supported and notes that a photo needs alt text on a site that requires it
<!-- AC:END -->
