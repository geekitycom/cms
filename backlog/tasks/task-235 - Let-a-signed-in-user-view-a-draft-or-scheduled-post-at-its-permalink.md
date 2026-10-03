---
id: TASK-235
title: Let a signed-in user view a draft or scheduled post at its permalink
status: To Do
assignee: []
created_date: '2026-10-03 15:55'
labels:
  - micropub
  - admin
  - web
dependencies: []
references:
  - packages/cms/src/admin/session.ts
  - packages/cms/src/web/documents.ts
priority: medium
type: feature
ordinal: 250800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
iA Writer (0.18.0 on shll.me) submits a post as a draft and then opens the URL Micropub returned in a browser, which answers 404 because a draft is not served. The session cookie's path is / (SESSION_COOKIE_PATH in src/admin/session.ts) and public pages already read the session for the admin bar, so the permalink can tell the author from a visitor.

Serve the post's HTML page at its permalink to a signed-in user when it is not served publicly because it is a draft, scheduled for later, or hidden by an unrecognized visibility value (isServed in src/web/documents.ts). Trashed posts stay 404. Anonymous visitors get the same 404 as today, with nothing that hints a hidden post exists. Micropub keeps returning the post's own permalink as Location.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A signed-in user gets 200 for a draft, a scheduled post, and a post with an unrecognized visibility at its permalink, with a visible banner saying it is not published and only signed-in users can see it
- [ ] #2 That response carries Cache-Control: private, no-store, noindex (header and meta), and no ETag a shared cache or a later anonymous request could reuse
- [ ] #3 An anonymous request for the same URL answers exactly as today (404, same body and headers as any unknown URL)
- [ ] #4 The .md, .json and ActivityStreams representations, feeds, lists, sitemap and search are unchanged for everyone
- [ ] #5 A trashed post still answers 404 to a signed-in user
- [ ] #6 Tests cover each, and the README documents it
<!-- AC:END -->
