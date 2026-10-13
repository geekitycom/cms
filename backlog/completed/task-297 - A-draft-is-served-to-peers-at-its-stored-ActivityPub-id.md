---
id: TASK-297
title: A draft is served to peers at its stored ActivityPub id
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:15'
updated_date: '2026-10-09 14:42'
labels: []
milestone: m-31
dependencies: []
priority: high
type: bug
ordinal: 257800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mount.ts activityStreamsDocument checks isFederatedDocument for the permalink lookup, but the stored-id branch (storedObjectAt → getByStoredObjectId, then `if (wantsObject) return await article(c, federation, stored)`) serves the object with no draft, schedule or visibility check. Only trash is filtered. A draft: true, future-dated or non-public post whose front matter carries activitypub.id (for example https://site/?p=123 from a WordPress import) can be fetched in full by any peer that asks with an ActivityStreams Accept header. This was found by reading the code, not reproduced. The andrewshell.org migration imports 63 drafts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A request with an ActivityStreams Accept header for the stored id of a draft, scheduled, or non-public post answers 404, as the permalink would
- [x] #2 A browser at that stored id is not redirected to the draft's permalink
- [x] #3 A published post at its stored id is served as today
- [x] #4 A regression test reproduces the leak before the fix
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a regression test in federation/article.test.ts beside the stored-id tests: a draft, a scheduled (future-dated) and a visibility: private post each carrying activitypub.id at a ?p= URL; an ActivityStreams request for each stored id answers 404 without the body, and a browser at each is not redirected. Run it red.
2. In federation/mount.ts activityStreamsDocument, after the trash branch, a stored-id post that is neither federated (isFederatedDocument) nor gone (isGone, a trashed once-public post) answers notFound to a peer and falls through to the public site for a browser.
3. Existing stored-id tests (Article at ?p=813, browser 301, path-shaped id) stay green for AC #3.
4. Run build, test, typecheck, lint, format:check; curl a running server at a draft's and a published post's stored id with and without the AS Accept header.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced first: the new test failed with 200 !== 404 for each of the draft (?p=901), the future-dated post (?p=902) and the visibility: private post (?p=903), run one at a time.

Fix in mount.ts activityStreamsDocument: after the trash branch, a stored-id post that is neither isFederatedDocument nor isGone gets notFound(c) for a peer and undefined (fall through) for a browser. Returning undefined for the peer too was tried first; it falls through to the site root and the negotiator answers 406, not the permalink's 404, so the peer branch answers 404 explicitly. isGone keeps today's behaviour for a trashed once-public post: a peer still gets the Tombstone from the branch above, and a browser is still redirected to the permalink (which shows the gone page). A trashed draft is not gone, so its stored id stops redirecting too.

A browser at a withheld ?p= id now gets whatever the site serves at /?p=N with no stored id, which is the home page (200, no Location); a path-shaped stored id gets the site's 404. Either way nothing says a post is there.

Validation: pnpm build && pnpm test (cms 5033 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Live server on scratch content (draft ?p=901, published ?p=902): AS ?p=901 -> 404, body absent; browser ?p=901 -> 200, no Location, body absent; AS ?p=902 -> 200 Article; browser ?p=902 -> 301 to /2011/06/live/; AS draft permalink -> 404. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post whose front matter carries activitypub.id is now served at that stored id only when it is federated (published, dated, public or unlisted) or gone. A draft, a future-dated post or one with an unrecognized visibility answers 404 to a peer, as its permalink does, and a browser there is no longer redirected to the permalink. Published stored ids still serve the Article and 301 a browser. Regression test in federation/article.test.ts failed before the fix for all three cases; full gate passes and a live server answered 404/200/301 as described in the notes.
<!-- SECTION:FINAL_SUMMARY:END -->
