---
id: TASK-360
title: Public URL rules are written once
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 01:29'
labels: []
milestone: m-35
dependencies:
  - TASK-359
type: chore
ordinal: 319800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/routes.ts (2135 lines) holds the router, URL grammar, Markdown, sitemap, llms.txt and embed builders. resolveRequest and canonicalTarget each re-derive the URL grammar, and the extension branch repeats it a third time. Listing kinds (home, tag, category, author) are branched on in about six functions. listing() and search() duplicate the pager and caching tail. frontPages(c) is recomputed at about 10 call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One path classifier is used by request resolution, canonical redirects and the extension routes
- [x] #2 Listing kinds are one modelled type that owns its count, list, href, feed href and title
- [x] #3 Paged responses share one caching helper
- [x] #4 Front pages, taxonomy bases and authors are resolved once per request
- [x] #5 routes.ts is split by concern (paths, Markdown, sitemap and llms.txt, embed)
- [x] #6 Every existing route test passes unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shapes (sketch, checked against every branch of routes.ts):

(a) PathMatch — what a decoded path names, from one classifier (web/paths.ts classifyPath(view, path)):
  | { kind: 'feed'; target: FeedTarget; format; canonical }   FeedTarget = { kind:'listing'; subject } | { kind:'comments'; document|undefined }
  | { kind: 'listing'; subject: ListingSubject; pageNumber }
  | { kind: 'document'; document }
  Order: '/' is the static homepage when there is one; then feed (as resolveRequest has it), then listing, then publicDocumentAt.
  - feed roots parse the Reading-agnostic grammar (/, /page/N/, /author/u/, /{base}/x/) and only page 0; else a document's comments feed (rss, shows its conversation). /comments/feed/ is rss only.
  - listing: the posts page ({permalink}, {permalink}page/N/) first; then, slashed paths only, home (/ and /page/N/: rooted at / with no homepage, under the posts page when there is one, nothing otherwise), author (username must be somebody's), term (must be carried; resolved to the site's spelling).
  - document: publicDocumentAt; a taxonomy/author path that is a live listing wins over a page there (current resolveRequest rule).
  Consumers: resolveRequest (serve, or 301 to canonicalHref(match) when the path is not it), canonicalTarget (slashless path + '/': canonicalHref, listing range-checked, else moved), the .md/.json branch (classify each candidate; documents and listings), markdownHrefFor (servedAt) and embeddableAt (document only).
  Divergences, all toward one rule: canonicalTarget used document-before-listing (now listing first, as live requests); the extension branch tried documents across all candidates before listings and redirected listings to the candidate spelling (now the canonical listing href, e.g. /tag/X/index.md -> /tag/x/index.md, and a page shadowed by an archive no longer leaks through index.md); /page/N/ stops being a route and goes through the classifier (/page/0/ 404s like /tag/x/page/0/; /page/1/ on a posts-page site lands on the posts page); every listing/document/feed canonical redirect keeps the query, as the term archive one did.

(b) ListingSubject — web/listing-subject.ts:
  | { kind:'home'; postsPage: Document|undefined } | { kind:'term'; term: TaxonomyTerm } | { kind:'author'; author: AuthorListing }
  archiveOf(view, subject) owns count(), list(paging), href(index), feedHref(format), about (term/person name), pageTitle(siteTitle), feedTitle(siteTitle), theme context, Markdown description and bio. ListingRequest = { subject; pageNumber } (the posts page moves from ListingRequest.document into the home subject). Sitemap iterates subjects instead of hardcoded tag/category loops.

SiteView (web/site-view.ts): { store, pages: FrontPages, bases, users(), authors: AuthorLookup, showsConversation(doc) }, built once per request and memoised on the Hono context (WeakMap), replacing frontPages(c) at ~10 sites and the bases/authors arguments.

Steps:
1. Pin edge cases in url-grammar.test.ts on current code (done: shadowed slugs, past-the-end pages, extensions on listings, moved permalinks with extensions, feed aliases).
2. Add failing tests for the intended divergences above.
3. Extract request helpers (web/request.ts), SiteView, ListingSubject, classifier; then handlers: listing-pages.ts (listing, search, one pageOf/pagedResponse caching helper), markdown-representation.ts, document-page.ts, feed-routes.ts, site-index.ts (sitemap, llms.txt), embed.ts, asset-routes.ts. routes.ts keeps mountPublicSite and resolveRequest.
4. Repoint importers (notify.ts, admin-bar, errors, maintenance, web/index.ts); public exports unchanged.
5. Verify: pnpm build/test/typecheck/lint/format:check; demo before/after curl diff.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Module layout under packages/cms/src/web/: routes.ts (381 lines: mountPublicSite table, declaredQueryRedirect, resolveRequest, serve, preview, renamed terms), paths.ts (PathMatch, classifyPath, canonicalHref, slashedHref, movedHref, commentsFeedHref, parseTermPath), listing-subject.ts (ListingSubject, archiveOf -> Archive, homeListing, homeHref, listingPageHref, feedHref), site-view.ts (SiteView memoised per Hono context via WeakMap, FrontPages, servedPath), request.ts (requestPath, notFound, gone, encodePath, conditionalHeaders, selectFromAccept, drawnForSomebody, wantsFullDocuments, queryFeedFormat, documentLabel), listing-pages.ts (listing, search, openPage + pagedResponse), markdown-representation.ts, document-page.ts (negotiateDocument), feed-routes.ts, site-index.ts (sitemap, llms.txt), embed.ts, asset-routes.ts. Importers repointed (notify.ts, federation/mount.ts, indieauth/discovery.ts, admin-bar, errors, maintenance, web/index.ts); package exports unchanged.

Behaviour changes, each pinned by url-grammar.test.ts: /tag/x/index.md answers the archive's Markdown where a page is permalinked at a carried archive (was the page's); oEmbed no longer embeds a page an archive shadows; a listing's .md/.json at a non-canonical spelling redirects to the canonical one (/tag/X/index.md, /news/page/1/index.md); canonical redirects of author archives, the posts page, documents served at / and feed aliases now keep the query, as term archives already did; /page/N/ is no longer a route: on a posts-page site /page/1/ -> posts page and /page/2 -> /news/page/2/ in one hop, /page/0/ 404s like /tag/x/page/0/, and on a static-homepage site with no posts page /page/1/ 404s (was 301 to /).

Verification: pnpm build && pnpm test (cms 5615 pass, 0 fail; all packages green), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Demo booted on :3417 before and after; 75 URLs (home, post and its .md/.json, tag archive page 2 and past the end, feeds and aliases, author archive, sitemap, llms.txt, search, oEmbed, 404s) diffed on status, location, etag, content-type, last-modified, link, cache-control, x-robots-tag and body hash: identical except /page/1/ (/ -> /posts/) and /page/2 (/page/2/ -> /posts/page/2/).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split web/routes.ts (2136 lines) by concern into paths, listing-subject, site-view, request, listing-pages, markdown-representation, document-page, feed-routes, site-index, embed and asset-routes; routes.ts keeps the route table and resolveRequest (381 lines). One classifier (classifyPath -> PathMatch: feed | listing | document) now serves resolveRequest, the slashless canonical redirect, the .md/.json routes, Markdown link rewriting and oEmbed. Listing kinds are one ListingSubject union (home | term | author) whose archiveOf owns count, list, href, feed href, titles and theme context; the sitemap iterates subjects. listing() and search() share openPage/pagedResponse. A SiteView (front pages, bases, users, authors) is built once per request. Small URL-grammar alignments are listed in the notes and pinned in url-grammar.test.ts. Verified with pnpm build/test/typecheck/lint/format:check and a before/after curl diff of 75 demo URLs.
<!-- SECTION:FINAL_SUMMARY:END -->
