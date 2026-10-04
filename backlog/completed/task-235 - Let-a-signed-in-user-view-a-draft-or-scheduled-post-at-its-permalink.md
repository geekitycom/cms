---
id: TASK-235
title: Let a signed-in user view a draft or scheduled post at its permalink
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 15:55'
updated_date: '2026-10-03 18:17'
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
- [x] #1 A signed-in user gets 200 for a draft, a scheduled post, and a post with an unrecognized visibility at its permalink, with a visible banner saying it is not published and only signed-in users can see it
- [x] #2 That response carries Cache-Control: private, no-store, noindex (header and meta), and no ETag a shared cache or a later anonymous request could reuse
- [x] #3 An anonymous request for the same URL answers exactly as today (404, same body and headers as any unknown URL)
- [x] #4 The .md, .json and ActivityStreams representations, feeds, lists, sitemap and search are unchanged for everyone
- [x] #5 A trashed post still answers 404 to a signed-in user
- [x] #6 Tests cover each, and the README documents it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in packages/cms/src/web/preview.test.ts over HTTP against the real app: draft, scheduled and unrecognized-visibility posts give a signed-in user 200 with a banner; headers private, no-store, X-Robots-Tag noindex, robots meta, no ETag/Last-Modified, no 304 on If-None-Match, HEAD likewise; anonymous GET/HEAD/conditional answers byte- and header-identical to an unknown URL; .md/.json/ActivityStreams Accept stay 404 for both; feeds, lists, sitemap, search unchanged; trashed post 404 signed in.
2. src/web/documents.ts: name why a document is hidden (draft, scheduled, unrecognized visibility, trashed) so the permalink and the banner share one rule; isServed reads it.
3. src/web/routes.ts resolveRequest: when no served document is at the path, the request is signed in, and Accept picks HTML, serve a hidden-but-not-trashed document at its permalink through negotiateDocument with noindex. Everything else falls through to today's path untouched.
4. Banner: the public admin bar template draws an in-flow notice after the fixed bar when the shown document is not served, so it shows in every theme; the admin-bar middleware already makes the response private, no-store and strips validators.
5. README: document the preview. Run build, test, typecheck, lint, format:check; curl a running site signed in and anonymous.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: web/documents.ts names why a document is hidden (HiddenReason: trashed, draft, scheduled, unrecognized-visibility) and isServed reads it; previewDocumentAt returns a hidden, untrashed document at a permalink. resolveRequest serves it through negotiateDocument only when the request is signed in and Accept picks HTML, after the public lookup and before the .md/.json and redirect lookups; everything else falls through to the unchanged 404. negotiateDocument marks any page that is not listed noindex (header and meta), which covers unlisted as before. The banner is drawn by the public admin bar template as an in-flow <p> after the fixed bar, so every theme shows it without script, and says why the post is hidden. The admin-bar middleware and negotiateDocument's private flag already give private, no-store with no ETag/Last-Modified and never a 304.

Two admin tests in src/admin/posts.test.ts checked a hidden post's 404 with the signed-in agent; they now check it as an anonymous reader, which is what they meant.

Verified: pnpm build, test (3782 + 30 pass), typecheck, lint, format:check. src/web/preview.test.ts covers every AC; a mutation that drops the signed-in/HTML guard fails AC #3 and #4 tests. curl against a scratch site (geekity serve, user ada): signed in, /draft/, /scheduled/, /odd/ answer 200 with the banner, cache-control private, no-store, x-robots-tag noindex, robots meta, no ETag/Last-Modified, HEAD the same, If-None-Match: * still 200; .md, .json, Accept markdown/json/activity+json 404; /trashed/ 404 as /no-such-thing/. Anonymous GET, HEAD, If-None-Match, If-Modified-Since and the three Accepts answer each hidden URL with headers and body identical to /no-such-thing/ once the URL itself and content-length are normalised (the 404 page names the URL it was asked for). Lists, feeds, sitemap, search and /index.json name none of the hidden posts signed in.

Not changed, by choice: the anonymous 404 carries no Cache-Control and no Vary: Cookie, as today. A shared cache that holds a heuristically cached 404 could hand it to the signed-in author; adding Vary or Cache-Control to only these 404s would reveal the post exists, and changing every 404 is outside this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A signed-in user now gets the HTML page of a draft, scheduled post or post with an unrecognized visibility at its permalink, under a banner saying why it is not published and that only signed-in users can see it, with Cache-Control: private, no-store, X-Robots-Tag and meta noindex, and no validator. Anonymous requests, trashed posts and every other representation and list are unchanged. Verified by src/web/preview.test.ts, the full build/test/typecheck/lint/format run, and curl of a running site signed in and anonymous.
<!-- SECTION:FINAL_SUMMARY:END -->
