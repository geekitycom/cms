---
id: TASK-330
title: A backlink counts through the homepage and the site's redirects
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 18:09'
updated_date: '2026-10-10 18:42'
labels:
  - themes
  - indieweb
dependencies:
  - TASK-322
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/webmention/links.ts
priority: low
type: enhancement
ordinal: 289800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-322 resolves a backlink by the target's permalink and redirect_from only. Two cases miss: a link to / does not count for the page set as the static homepage, because its permalink is not /; and a link through a declared redirect does not count, including the WordPress forms the import declares in _data/redirects/wordpress.json (/?p=ID, /?page_id=ID, old slugs), because the query is dropped and redirects are not consulted. A site migrated from WordPress is full of ?p= links between its own posts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A link to / counts as a backlink for the page the Reading setting makes the homepage
- [x] #2 A link to any URL the site answers with a redirect to a document (redirect_from, _data/redirects.json, _data/redirects/*.json, including /?p=ID and /?page_id=ID) counts for that document, following the same resolution the site uses to redirect
- [x] #3 A link whose redirect is later removed or retargeted stops counting or moves, without rewriting the linking post
- [x] #4 Tests cover the homepage and a ?p= link from an imported post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: document_links keeps the link's query (migration 12 recreates it as (path, target, query), query = the sorted query string or '', keys_base reset so rows refill from stored html). webmention/links.ts ownSiteLinks returns { path, query } per link, query sorted as the redirect table sorts it (sortedQuery exported from web/redirects.ts).
2. web/redirects.ts exports the forward steps routes already use: findQueryRedirect, a new findPathRedirect (the path-plus-slash lookup moved out of resolveRequest, which now calls it), sortedQuery, redirectLocation.
3. webmention/links.ts linksInto(table, keys, answers): starting from the paths a document is answered at, walks a per-table inverse index of redirect sources by where they point and keeps each source whose forward landing (query redirect, then a served document or former permalink, then a declared path redirect, the routes' order) ends on one of those paths. Returns the path keys and query keys that lead to the document, plus the query keys that intercept one of its paths elsewhere (a link to /?p=7 is not a link to the homepage).
4. ContentStore.listBacklinks(document, { redirects?, home? }): keys are permalink, live redirect_from, and / when home; SQL matches path keys with any query not intercepted, or an exact query key. Resolved per read, so editing a redirect file moves or drops a backlink with no rewrite.
5. index.ts passes redirects.current() and whether the document is the Reading homepage (frontPageSlugs + getBySlug, as routes' publicPage).
6. Tests first: store tests for /, ?p=, ?page_id=, /?p=7&foo, a chain, a shadowed path source, retarget and removal; links.test for query keeping; HTTP test with _data/redirects/wordpress.json and homepage in site.json; migration list.
7. pnpm build/test/typecheck/lint/format:check; curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: content migration 12 recreates document_links as (path, target, query): target is the normalised site path as before, query is the link's query sorted the way a redirect source is keyed (sortedQuery from web/redirects.ts), '' for none. ownSiteLinks now returns SiteLink { path, query }.
Resolution is read-time (AC#3): ContentStore.listBacklinks(document, { redirects, home }) starts from the paths the document is answered at (permalink, live redirect_from, and / when home) and calls webmention/links.ts linksInto(table, answeredAt, answers). linksInto walks a per-table inverse index (WeakMap on the RedirectTable, which createRedirectSource keeps the same object while the files are unchanged) backwards from those paths, and confirms each candidate source by following it forwards with the routes' own steps in the routes' order: findQueryRedirect, then answers (a served document at the path or a former permalink), then findPathRedirect (moved out of resolveRequest into web/redirects.ts; routes.ts now calls it). It returns path keys (any query matches), exact query keys, and intercepted query keys (a query redirect that takes a link to one of the paths elsewhere, so /?p=7 is not a link to the homepage). /?p=7&foo is not an exact source, so it lands on / as a request does.
Homepage: index.ts passes home = page whose slug is frontPageSlugs(site).homepage and which getBySlug answers, as routes' publicPage does. The default front-page.njk does not print backlinks (most of a site links home); a site theme adds the include, documented in the theme README.
Approximations: a declared path source is treated as shadowed only by a served document or a former permalink at it, not by an archive, feed or gone document; a query source is also matched with the trailing slash added; locations naming an absolute URL are treated as off-site.
Verified: store tests (homepage, ?p= and ?page_id=, extra query, chain through a former permalink and two declared paths, shadowed vs drafted source, retarget and removal with the linking posts untouched), links tests, HTTP tests in web/backlinks.test.ts with _data/redirects/imported.json + homepage (named so the core plugin-boundary test does not flag the platform name). Scratch site with _data/redirects/wordpress.json over curl: /2019/05/first-post/ listed Second post (http://localhost:3330/?p=7) and Third post (/old-first); / listed Second (/ and /?page_id=12) and Third (/?p=7&utm=x, which the site serves as / with 200); removing the entries emptied the first post's list and retargeting /?p=7 moved Second post to the third post, with no content edit.

Validation: pnpm build, pnpm test (cms 5368 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A backlink now counts wherever the site sends the link. A link to / counts for the Reading homepage, and a link to any URL the site redirects counts for the document the redirect leads to. That covers redirect_from, _data/redirects.json, _data/redirects/*.json, and the imported /?p=ID and /?page_id=ID. document_links keeps each link's sorted query (migration 12). Redirects are resolved when the backlinks are read, using the same lookups and the same order the routes use (findQueryRedirect, then served or former documents, then findPathRedirect, which now lives in web/redirects.ts), so retargeting or removing a redirect moves or drops a backlink without rewriting any post. A link like /?p=7&foo, which matches no source exactly, lands on / as a request does. The front page's context carries backlinks, and the default front-page layout does not print them. Covered by store, links and HTTP tests and by curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
