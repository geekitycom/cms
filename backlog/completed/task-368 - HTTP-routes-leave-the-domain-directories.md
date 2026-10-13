---
id: TASK-368
title: HTTP routes leave the domain directories
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 14:01'
labels: []
milestone: m-36
dependencies:
  - TASK-366
priority: medium
type: chore
ordinal: 327800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hono route files sit inside feature directories: comments/routes.ts, comments/viewer.ts, webmention/routes.ts, webmention/pingback.ts and federation/mount.ts. That ties those features to the HTTP framework. Keep the features as plain functions over requests the delivery layer has already parsed, and move the Hono wiring into the delivery layer named by the layer map.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No non-test module under comments/, webmention/ or federation/ imports hono
- [x] #2 The layer-map check from the previous task enforces this
- [x] #3 Routes, status codes and responses are unchanged; existing route tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit route coverage of the five files; add missing contract tests (bodies, 404, 405) against the current location and see them pass.
2. Add a 'no hono below the public site' rule to layer-boundary.test.ts (bare specifiers hono and hono/*); see it fail on today's five files and on a planted import.
3. Move the Hono wiring into web/, keeping feature logic in the feature as plain functions:
   - comments/routes.ts: mountComments + request/response helpers -> web/comment-routes.ts; commentFormFor, commentNoticeFor, commentReplyTarget stay in comments/ (comments/form-for.ts).
   - comments/viewer.ts: signedInAccount, signedInCommenter (read the session cookie) -> web/signed-in.ts; SignedInAccount and commenterOf stay.
   - admin/documents.ts documentSite (+ currentUsername) -> web/document-site.ts, since it only reads the request context; admin imports it from web/.
   - webmention/routes.ts -> webmention/endpoint.ts (WEBMENTION_PATH, fields, webmentionEndpointFor); mountWebmentions -> web/webmention-routes.ts.
   - webmention/pingback.ts keeps constants, pingbackEndpointFor, XML-RPC call parsing and the outcome->answer mapping; mountPingbacks, body reading and the XML response -> web/pingback-routes.ts.
   - federation/mount.ts: WEBFINGER_PATH, acctOf and the resource matching (plain over users) -> federation/webfinger.ts; mountFederation, webFingerSubject(c, resource), contextData and the ActivityStreams handlers -> web/federation-routes.ts.
   - Public names routed through web/index.ts barrel; exports.ts takes them from there.
4. Delete the five EXCEPTIONS; update docs/development.md Source layers.
5. Prove export lists of src/index.ts, src/plugin.ts, src/exports.ts unchanged; run pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Coverage first. Route tests added BEFORE the move, against the old files, all green there:
- webmention/receive.test.ts 'what the endpoint answers, word for word': 202 body 'Accepted. The source will be checked shortly.' (text/plain), 400 body is the check's message, 404 body when webmentionsReceive is false, GET 405 with Allow: POST and its body.
- webmention/pingback.test.ts same block: success body byte for byte with content-type 'text/xml; charset=utf-8', fault struct byte for byte (-32601), 404 body, GET body.
- comments/site.test.ts 'a submission for a post that is not there': 404 'There is no such post to comment on.' for an unknown slug and for a draft.
- comments/signed-in.test.ts: bodies of the two 403s (stale token, cross-site) asserted.
Federation routes were already covered by federation/federation.test.ts (WebFinger 200 JRD with content-type and CORS, 404, /@handle 301 and 404, stored actor id), federation/article.test.ts (Article at permalink, 410 Tombstone, stored id 301, drafts), web/plugin-federation.test.ts, web/author-archive.test.ts; that code moved without edits.

Moves (git mv, callers rewritten, no shims):
- comments/routes.ts -> web/comment-routes.ts (mountComments, request parsing, refusal pages). commentFormFor, commentNoticeFor, commentReplyTarget, drawnFor -> new comments/page-form.ts.
- comments/viewer.ts: signedInAccount, signedInCommenter -> new web/signed-in.ts. SignedInAccount and commenterOf stay.
- admin/documents.ts documentSite + currentUsername -> new web/document-site.ts. They only read the request context, so they sit in web/ and admin imports them from there. The comments route no longer reaches into admin/.
- webmention/routes.ts -> web/webmention-routes.ts (mountWebmentions). WEBMENTION_PATH, WEBMENTION_FIELDS, webmentionEndpointFor -> new webmention/endpoint.ts.
- webmention/pingback.ts -> web/pingback-routes.ts (mountPingbacks, body reading, XML response). New webmention/pingback.ts keeps the constants, pingbackEndpointFor, and the XML-RPC parse and answer mapping, now exported as readPingbackCall, pingbackAnswerFor, PINGBACK_REQUEST_FAULTS and PingbackFault.
- federation/mount.ts -> web/federation-routes.ts (mountFederation, webFingerSubject(c, resource), contextData, ActivityStreams handlers). WEBFINGER_PATH, acctOf and the resource matching (new plain webFingerUser(users, resource, baseUrl)) -> new federation/webfinger.ts.
- Barrels: web/index.ts exports mountComments, signedInCommenter, mountFederation, webFingerSubject and MountFederationOptions. exports.ts takes them from there. comments, federation and webmention barrels point at the new homes.

CONTRACT changes, all internal: documentSite's module; webmention barrel no longer exports mountWebmentions or mountPingbacks (never public); pingback helpers newly exported from webmention/pingback.ts. Public export list of src/index.ts, src/plugin.ts and src/exports.ts is identical before and after (2478 lines, name and value/type kind, TS 6 checker script diff).

Check: layer-boundary.test.ts has a new test, 'keeps Hono out of every layer below the public site'. It flags bare specifiers hono, hono/*, @hono/* and @fedify/hono in any unit ranked below web/. Red first on the tree: 6 offences, exactly the five files. Proved again after the move by planting 'hono' and a multi-line 'hono/tiny' import in comments/policy.ts (failed, naming lines 102 and 105), then reverted. A planted ../web/ import in comments/viewer.ts fails the layer rule now that no exception covers it. EXCEPTIONS is empty. The grep showed no other unit below web/ imports hono (access-log.ts and drain.ts sit above web/).
docs/development.md Source layers: the Hono rule paragraph, and 'No exceptions are left.'
Validation from repo root: pnpm build, typecheck, lint, format:check exit 0. pnpm test exit 0 (cms 5747 = 5736 + 11 new, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106).
Left alone: admin/preview.ts keeps its own copy of currentUsername, and micropub/endpoint.ts still builds its DocumentSite by hand (it could use documentSite).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Hono wiring of comments, webmentions, pingbacks and federation moved into web/ (comment-routes, webmention-routes, pingback-routes, federation-routes, signed-in, document-site). The features keep their rules as plain functions: comments/page-form.ts, webmention/endpoint.ts, webmention/pingback.ts and federation/webfinger.ts. documentSite moved from admin/ to web/document-site.ts, so the comment route no longer imports admin/. layer-boundary.test.ts now fails on any hono, hono/*, @hono/* or @fedify/hono import below the public-site layer: it failed on the five files before the move, and it fails on a planted import. All five exceptions are deleted. Contract tests for bodies, 404s and 405s were added before the move and pass unchanged after it. The public export list is identical. Verified with pnpm build, test (cms 5747, demo 32, plugins 48/22/31/106), typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
