---
id: TASK-232
title: ActivityStreams request for a post answers 500 on a site with no users
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 12:48'
updated_date: '2026-10-03 13:39'
labels:
  - federation
dependencies: []
priority: low
type: bug
ordinal: 247800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-227: on a site with no user accounts, requesting a post URL with an ActivityStreams Accept header answers 500 instead of 404. It happens for public posts too, so it predates TASK-227. A site with no users has no actor to attribute the object to; the object dispatcher (src/federation/federation.ts setObjectDispatcher, src/federation/article.ts) should answer 404 rather than throw.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With no users, an ActivityStreams request for a post URL answers 404, proven by a test
- [x] #2 With users, the response is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: in federation/article.test.ts, a site with no accounts answers 404 for an ActivityStreams request at a public post's permalink, an unlisted post's permalink and a migrated post's stored activitypub.id (today 500, because postObject's attribution() throws).
2. Root cause: mount.ts activityStreamsDocument decides a post is an object from isFederatedDocument alone, then article() builds it with postObject, whose attribution() throws when documentAuthor finds no user. Fix in article(): resolve documentAuthor first and answer the site's 404 (web/routes.ts notFound) when there is no actor, since a post with nobody to attribute it to is no object. Falling through instead would reach the negotiator's 406, not the 404 asked for.
3. Pin AC #2: with users, a post whose author names nobody still answers 200 attributed to the first account (documentAuthor's fallback); existing object tests stay green.
4. Verify: pnpm build/test/typecheck/lint/format:check, and curl a running site with no users.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: mount.ts activityStreamsDocument treats a post as an object on isFederatedDocument alone and hands it to article(), which calls postObject; postObject's attribution() throws when documentAuthor finds no user, and the throw surfaced as a 500. The visibility rules (isServed via isFederatedDocument) were never the problem and are unchanged.

Fix: article() in mount.ts now asks documentAuthor first and answers the site's own 404 (web/routes.ts notFound) when there is no actor. It is the one funnel for both the permalink and the stored activitypub.id paths, so both are covered. Falling through to next() was rejected: the negotiator then answers 406, as it does for a page, not the 404 asked for. attribution()'s throw stays: delivery and the outbox never reach it without a user.

Author missing on a site with users: documentAuthor falls back to the first account, so the object is served (200, attributedTo the first account); pinned by a new test.

Validation: pnpm build && pnpm test (3659 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check, all exit 0. New test failed first with 500 ('the site has no accounts'). curl against a running site with an empty data dir and one post: Accept: application/activity+json -> 404 text/html; plain GET -> 200. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A site with no user accounts answered 500 to an ActivityStreams request for a post, because the permalink middleware built the object before knowing there was an actor to attribute it to. article() in federation/mount.ts now answers the site's 404 when documentAuthor finds nobody, for both the permalink and a migrated post's stored id. With users nothing changes, and a post whose author names nobody is still attributed to the first account. Verified with two new tests in federation/article.test.ts (the no-accounts one failed with 500 before the fix), the full build/test/typecheck/lint/format run, and curl against a running no-user site (404 for activity+json, 200 for the page).
<!-- SECTION:FINAL_SUMMARY:END -->
