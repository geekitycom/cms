---
id: TASK-45
title: Sitemap and robots.txt
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 05:27'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-5
  - TASK-36
references:
  - 'https://www.sitemaps.org/protocol.html'
type: feature
ordinal: 27850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serve `/sitemap.xml` listing every public post and page (absolute URL and `lastmod` from `updated` or `date`), the home page, the paged listings, and every tag and category archive under the configured bases, split into a sitemap index when a single file would pass the protocol's limits. Serve `/robots.txt` allowing everything public, disallowing `/admin/`, and pointing at the sitemap. Both are fixed routes like the feeds, respect drafts, trash and scheduled posts, and send ETag and Last-Modified like the feeds do. The base layout does not need to link the sitemap; robots.txt does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /sitemap.xml validates against the sitemap protocol and lists every public post, page, listing page and taxonomy archive with lastmod, and nothing that is a draft, trashed or scheduled
- [x] #2 /robots.txt disallows /admin/ and names the sitemap URL
- [x] #3 Both answer conditional requests with 304 and change when content changes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `src/web/sitemap.ts` (new): the vocabulary — `SITEMAP_PATH` (`/sitemap.xml`), `SITEMAP_CHILD_PATTERN`/`sitemapChildPath(n)` (`/sitemap-N.xml`), `ROBOTS_PATH` (`/robots.txt`), `SITEMAP_NAMESPACE`, `SITEMAP_MAX_URLS = 50000`, `SitemapUrl { loc, lastmod? }`, `sitemapXml`, `sitemapIndexXml`, `sitemapResponse`, `robotsTxt`, `robotsResponse`. The max is a parameter with a default so the split is tested with three URLs rather than fifty thousand fixtures.
2. Enumeration in `src/web/sitemap.ts`: `siteUrls({ store, renderer, now })` returning the home listing's pages (posts sliced by `pageSize()`, `homeHref(i)`, lastmod = newest on that page), every public post and page (`store.listAll({ draft: false, trashed: false, scheduled: false })`, lastmod = `lastModifiedOf`), and every tag and category archive page from `listTags()`/`listCategories()` and `termHref(term, i, bases)`. `isPublicDocument(document, store.now())` guards anything the store hands back, so the sitemap and the listings agree.
3. Validators: build the ETag (`contentEtag('sitemap', …)` over the loc/lastmod list) and Last-Modified first, then decide the 304, exactly as `feedResponse` does, so a 304 still carries them. Same for robots over its own body.
4. Routes in `mountPublicSite`: `/sitemap.xml` (a `<urlset>`, or a `<sitemapindex>` naming `/sitemap-1.xml`… once the count passes the max), `/sitemap-:page{[0-9]+}.xml` (one chunk, 404 when there is no index or the chunk is past the end) and `/robots.txt`, all real routes like the site feeds so no permalink can take them.
5. `RESERVED_TOP_LEVEL_PATHS` gains `sitemap.xml` and `robots.txt`, and the drift test in `taxonomy.test.ts` gains the two new route paths.
6. robots.txt: `User-agent: *`, `Disallow: /admin/`, and an absolute `Sitemap:` line. `/ap/` is not disallowed — actor and object URLs exist to be fetched, and a crawler that follows one gets JSON it will ignore.
7. Move the strict XML reader out of `feeds.test.ts` into `src/web/__testing__/xml.ts` (the `__testing__` convention the admin already uses, excluded from the build) so the sitemap is proved well formed by the same independent reader.
8. Tests: `src/web/sitemap.test.ts` over `cms.app.request` — every public URL present with a lastmod, drafts/trashed/scheduled absent, the paged listing and archive URLs, the index split at an injected max, robots' two facts, the 304s, and the ETag moving when a post changes.
9. Docs: the public-site route table and a Sitemap section in `packages/cms/README.md`, the root README where it lists what the site serves, and doc-3 if it names the fixed routes.
10. Verify: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` from the root, then the running demo over curl — `/sitemap.xml` and `/robots.txt`, `xmllint --noout` plus an xml2js pass over every url/loc/lastmod, `If-None-Match` 304s, and the ETag moving after a content change.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

A search engine can now read the whole site off two files it fetches without being told to.

- **`src/web/sitemap.ts`** (new): `SITEMAP_PATH`, `ROBOTS_PATH`, `SITEMAP_CHILD_ROUTE` (`/sitemap-:page{[0-9]+}.xml`), `sitemapChildPath`, `SITEMAP_NAMESPACE`, `SITEMAP_MAX_URLS`, `SITEMAP_CONTENT_TYPE`, `ROBOTS_CONTENT_TYPE`, `SitemapUrl`, `sitemapDate`, `sitemapXml`, `sitemapIndexXml`, `sitemapResponse`, `robotsTxt`, `robotsResponse`. It writes the documents and answers the requests; what goes *in* the sitemap is assembled in `routes.ts`.
- **`src/web/routes.ts`**: three new routes registered in `mountPublicSite` beside the site feeds, plus the private `sitemapUrls(c)` that enumerates them and `sitemap(c, page)` that serves one.
- **`RESERVED_TOP_LEVEL_PATHS`** gains `sitemap.xml` and `robots.txt`, and the drift test in `taxonomy.test.ts` gains the two paths so the list cannot fall behind the routes.
- **`src/web/__testing__/xml.ts`** (new): the strict XML reader moved out of `feeds.test.ts`, which now imports it. Same reader, two kinds of document.

## What the sitemap holds

The home archive and each of its pages, every published post and page at its permalink, and every tag and category archive with each of its pages under the bases the site holds at that moment. Every `<loc>` is absolute on `baseUrl`. `<lastmod>` is a document's `updated` else its `date`, and for a listing page the newest of those among the documents on it.

## Decisions

- **The enumeration lives in `routes.ts`, the documents in `sitemap.ts`.** The same split the feeds have: `feeds.ts` knows what an RSS channel looks like and `routes.ts` knows what goes in one. It is also what keeps the import graph acyclic — the URLs are spelled by `homeHref`, the permalinks and `termHref`, and `homeHref` is `routes.ts`'s.
- **Nothing derives the rule about what is public a second time.** The sitemap is drawn from `listPosts`, `listAll({ draft: false, trashed: false, scheduled: false })`, `listTags` and `listCategories` — the queries the listings use — and filtered again by `isPublicDocument(document, store.now())` with the store's own clock, so the sitemap and the listings answer to one rule and one moment. Drafts, the trash and posts whose date has not arrived are absent for exactly the reason their permalinks 404.
- **A listing page is dated by the newest thing on it**, which costs one unpaginated query per taxonomy term and none for the archive, because the posts are in hand already. The alternative — dating every page by the newest thing on the site — would tell a crawler that page 40 changed every time somebody published.
- **Something nothing dates carries no `<lastmod>`.** A page with no `date` in its front matter gets the element left out rather than the file's mtime or today: the field is optional in the protocol, and an invented date is a lie a crawler acts on.
- **The split threshold is a parameter with a default.** `sitemapResponse({ maxUrls })` is how the index is proved with three URLs and a limit of two rather than 50,001 fixtures. The protocol's other ceiling, 50 MB, is not enforced separately: an entry is a `<loc>` and a `<lastmod>`, around 120 bytes, so a full 50,000-URL file is nearer 6 MB than 50 and the count is always the binding constraint. Recorded in the constant's doc comment.
- **The index lives at `/sitemap.xml` itself**, with children at `/sitemap-1.xml` and up. The address a search engine already holds does not move when a site grows past the limit. While the whole thing fits in one file the children name nothing and 404 — an empty sitemap would be a URL a crawler kept coming back to.
- **`/ap/` is not disallowed in `robots.txt`.** An actor and an object are documents meant to be fetched, they carry the same content as the pages that link to them, and a crawler that follows one gets JSON it will ignore. Disallowing them would make the fediverse's view of the site depend on a file written for search engines.
- **No `Allow: /` line.** Everything not disallowed is allowed, and an `Allow` before a `Disallow` is the one ordering a first-match-wins crawler reads as permission to fetch the admin.
- **Both are registered routes, not permalinks.** Verified live: a page permalinked at `/sitemap.xml` does not shadow the sitemap. The reserved-list entries are belt and braces — `TAXONOMY_BASE_PATTERN` would refuse either word for the dot anyway — but the list is what the drift test checks, and both are paths the site answers on.
- **Validators before the 304, as the feeds do it.** A crawler polling with `If-None-Match` gets the ETag and the `Last-Modified` on the 304 as well as on the body. `robots.txt` has an ETag but no `Last-Modified`: nothing dates it, and its body is a function of the site's origin alone.

## Known and left alone

A document permalinked at a path a route already answers on — `/sitemap.xml`, `/feed/`, `/robots.txt` — is unreachable but still appears in the sitemap, because it is an indexed public document. That is a pre-existing consequence of routes winning over permalinks rather than anything this change introduced, and filtering it would mean a second, separate list of every route path.

## Verification

**Tests.** 15 new cases in the new `src/web/sitemap.test.ts`, over `cms.app.request` except for the three that need an injected split threshold. Four mutation-checked, each failing exactly what names it: listing every post instead of the public ones (the drafts/trash/scheduled case fails alone), never splitting (all three index cases), and disabling the 304 (both conditional cases).

**Checks, from the repository root.** `pnpm build` clean; `pnpm test` 767 pass / 0 fail (`@geekity/cms`, up from 752) and 11 / 0 (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` clean.

**Live, against the demo on port 3000.**

- **AC #1.** `/sitemap.xml` 200 `application/xml; charset=utf-8`, 19 `<url>` entries. `xmllint --noout --schema` against the official `sitemap.xsd`, fetched from sitemaps.org: **validates**. An independent sax-based reading (a throwaway script over `xml2js`) confirmed the namespace, exactly one absolute http `<loc>` per entry, at most one `<lastmod>` and every one of the 17 a `YYYY-MM-DDThh:mm:ssZ` that `Date.parse` accepts, and no element other than those two — then fetched all 19 `<loc>`s and got 200 from every one. Both checkers reject a damaged copy: `xmllint` reports `'yesterday' is not a valid value of ... tLastmod`, and the script rejects that and a relativised `<loc>`, so neither is vacuous. The list was the home archive (`/`, `/page/2/`, `/page/3/` — `/page/4/` 404s), all five published posts, all three pages, `/tag/content/` with its `page/2/`, `/tag/sqlite/`, `/tag/web/`, `/tag/theme/`, `/category/engineering/` with its `page/2/` and `/category/general/`. The demo's one draft, `a-draft-nobody-can-see`, appears nowhere in it.
- **The index and children** cannot be reached with 19 URLs, so they were built through `sitemapResponse` with seven URLs and a limit of three and validated the same way: the `<sitemapindex>` validates against the official `siteindex.xsd`, naming `/sitemap-1.xml`, `/sitemap-2.xml` and `/sitemap-3.xml` each dated by its own newest URL; all three children validate against `sitemap.xsd` and hold 3, 3 and 1 URLs; a fourth child does not exist. Live, `/sitemap-1.xml` and `/sitemap-2.xml` 404, which is the same route and the same parameter parsing reaching the same `undefined`.
- **AC #2.** `/robots.txt` 200 `text/plain; charset=utf-8`, three lines: `User-agent: *`, `Disallow: /admin/`, `Sitemap: http://localhost:3000/sitemap.xml`.
- **AC #3.** Both carry an ETag and answer their own with `304` — headers intact on the 304, including the sitemap's `Last-Modified: Wed, 02 Sep 2026 16:00:00 GMT` — while a made-up `If-None-Match` gets 200. `If-Modified-Since: <now>` on the sitemap is a 304. Adding a page dated `2026-09-03T20:00:00Z` moved the ETag from `"728f7bc…"` to `"6ac74f7…"` and the `Last-Modified` to `Thu, 03 Sep 2026 20:00:00 GMT`, put `/sitemap-check/` in the document (20 entries, all still 200, still schema-valid), and turned the old ETag's conditional request back into a 200. Deleting the page put the sitemap back byte for byte and restored the original ETag.
- **Shadowing.** A page permalinked at `/sitemap.xml` was added: `/sitemap.xml` still answered with the `<urlset>`. Removed again.

Everything the pass wrote was removed. `git status apps/demo` shows only the pre-existing `content/_data/site.json` edit and `content/uploads/`; `pgrep -fl "tsx watch"`, `pgrep -fl server.ts` and a request to port 3000 all report nothing.

## Docs

`packages/cms/README.md`: three rows in the public-site route table, a new "Sitemap and robots.txt" section, and the Eleventy section now says the two files do not carry over for the same reason the feeds do not. The root README's route table gains two rows. doc-3 gains a "Crawlers" section beside its Feeds one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A search engine can now read the whole site off two files it goes looking for on its own: `/sitemap.xml` and `/robots.txt`, both fixed routes registered beside the site feeds so a document permalinked at either address cannot take the URL a crawler polls.

The sitemap lists the home archive and each of its pages, every published post and page, and every tag and category archive with each of their pages under whatever bases the site holds at that moment — every `<loc>` absolute on `baseUrl`, and `<lastmod>` a document's `updated` else its `date`, or for a listing page the newest of those among the documents on it. A page nothing dates carries no `<lastmod>` rather than an invented one.

Nothing derives a second time what is public. The URLs come from the same queries the listings use and are filtered again by `isPublicDocument` with the store's own clock, so drafts, the trash and posts whose date has not arrived are absent for exactly the reason their permalinks 404, and the sitemap and the site cannot drift apart about either the rule or the moment. The URLs themselves are spelled by `homeHref`, the permalinks and `termHref`, which is why the enumeration sits in `routes.ts` and only the documents and the responses in the new `src/web/sitemap.ts` — the same split the feeds already have.

Past the protocol's 50,000 URLs, `/sitemap.xml` becomes a `<sitemapindex>` naming `/sitemap-1.xml` and up, each child dated by its newest URL: the address a search engine already holds does not move when a site outgrows one file, and while it fits the children 404 rather than serving an empty file a crawler would keep returning to. The threshold is a parameter with a default, which is how the split is proved with three URLs and a limit of two instead of 50,001 fixtures.

`robots.txt` is three lines — `User-agent: *`, `Disallow: /admin/`, and the sitemap's absolute URL. Nothing else is closed; `/ap/` is left open deliberately, because an actor and an object exist to be fetched and a crawler that follows one gets JSON it will ignore. Both responses build their validators before deciding the 304, so a polling crawler gets the ETag and the `Last-Modified` on the 304 it mostly receives.

Verified by 15 new node:test cases in `src/web/sitemap.test.ts`, four of them mutation-checked, and by a live pass against the demo: `xmllint --noout --schema` against the official `sitemap.xsd` and `siteindex.xsd` from sitemaps.org, an independent sax-based reader that checked every `<loc>` and `<lastmod>` and then fetched all 19 URLs for a 200 apiece — both rejecting a deliberately damaged copy — the draft in none of it, `/robots.txt`'s two facts, 304s on both from `If-None-Match` and on the sitemap from `If-Modified-Since`, and an added page moving the ETag and the `Last-Modified` and then a deleted one putting the sitemap back byte for byte. The strict XML reader moved from `feeds.test.ts` into `src/web/__testing__/xml.ts` so both kinds of document are proved well formed by the same independent parser. `pnpm build`, `test` (767 + 11), `test:11ty` (9 + 5), `typecheck`, `lint` and `format:check` all pass; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
