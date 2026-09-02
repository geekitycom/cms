---
id: TASK-7
title: Atom and JSON Feed for posts
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 21:04'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-5
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixed routes /feed.xml (Atom 1.0) and /feed.json (JSON Feed 1.1) over the most recent published posts, plus per-tag variants at /tags/{tag}/feed.xml. Feeds are not negotiated (doc-3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /feed.xml validates as Atom with entries carrying id, title, updated, link, and full HTML content
- [x] #2 /feed.json validates against JSON Feed 1.1 with the same entries
- [x] #3 The HTML layout advertises both feeds with link rel=alternate
- [x] #4 Drafts never appear in feeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/web/feeds.ts: an in-house XML escaper, feedSize(site) (site.json `feedSize`, default 20), atomFeed() and jsonFeed() builders, and feedResponse() that sets the feed content type and reuses the TASK-6 conditional-request helpers for ETag/304.
2. Widen the TASK-6 validator helper minimally: export contentEtag(kind, fingerprint) from negotiate.ts (representationEtag delegates to it) and move latestModified() there so routes and feeds share one implementation.
3. Register /feed.xml, /feed.json, /tags/:tag/feed.xml and /tags/:tag/feed.json as normal app.get routes in mountPublicSite, before app.notFound, so feeds never reach the negotiator (doc-3).
4. Fill the base layout's empty {% block alternates %} with rel=alternate links for both feeds, and override it in layouts/tag.njk to add the per-tag feeds via super().
5. Test-first with node:test through cms.app.request() over temp content dirs (watch: false, await cms.sync()): a test-local strict XML parser proves the Atom output is well formed and carries the required feed and entry elements; JSON Feed assertions follow the 1.1 spec; plus drafts/trash exclusion, tag feeds, limits, content types, ETag/304 and the HTML alternates.
6. Document feeds in packages/cms/README.md (and the site-data key in themes/default/README.md); export the new symbols from src/web/index.ts and src/index.ts.
7. Verify: pnpm test, pnpm typecheck, pnpm build, then boot the demo and curl /feed.xml, /feed.json and a tag feed, run xmllint --noout on the Atom output, and confirm the home page carries the alternate links.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added src/web/feeds.ts: FeedFormat plus the FEED_FILES/FEED_CONTENT_TYPES tables, feedSize(site) (site.json `feedSize`, default 20), an in-house escapeXml that also drops characters XML 1.0 cannot represent, atomFeed()/jsonFeed() builders over a FeedSource, and feedResponse() for the content type, ETag, Last-Modified and 304. No new dependency.

Routes: /feed.xml, /feed.json, /tags/:tag/feed.xml and /tags/:tag/feed.json are registered in mountPublicSite() before app.notFound, so they never reach the negotiator (doc-3). A tag nothing published carries 404s rather than serving an empty feed, matching the tag archive.

Shared helpers rather than copies: negotiate.ts gained contentEtag(kind, fingerprint) (representationEtag now delegates to it) so the two formats and the two scopes each get their own validator, and latestModified() moved there from routes.ts, which now imports it. absoluteUrl() was also made base-path aware, matching the theme's absoluteUrl filter, so a site served from a subdirectory gets correct feed ids and JSON urls.

documentJson() was deliberately not reused for JSON Feed items: JSON Feed 1.1 names its own keys (id, url, content_html, date_published), so an item is built from the Document directly. Both feeds are built from the same store query, and a test asserts the two agree on entry ids.

An empty feed reports the Unix epoch as its <updated> rather than the clock, so the ETag does not change while nothing does.

Theme: layouts/base.njk fills its previously empty {% block alternates %} with the two site feed links; layouts/tag.njk overrides the block with super() and adds the tag's own two. Both go through the url filter, so they carry the base path.

Tests: src/web/feeds.test.ts, 18 node:test cases through cms.app.request() over temp content dirs (watch: false, await cms.sync()). The Atom output is proved well formed by a test-owned strict XML reader that rejects mismatched tags, unquoted attributes, a bare < or & in character data and content after the root; the JSON Feed is asserted against the 1.1 required fields.

Validation: pnpm test (245 tests, 245 pass, 0 fail; 18 of them the new src/web/feeds.test.ts), pnpm typecheck (packages/cms and apps/demo both clean) and pnpm build all green. Booted the demo with pnpm start and checked the live server: GET /feed.xml is 200 with content-type application/atom+xml; charset=utf-8 and passes `xmllint --noout`; GET /feed.json is 200 with application/feed+json; charset=utf-8, version https://jsonfeed.org/version/1.1 and 3 items; /tags/web/feed.xml is 200, well formed and holds the 2 tagged posts; /tags/nope/feed.xml is 404; re-requesting /feed.xml with the returned If-None-Match gives 304; the demo's draft post appears in neither feed; the home page head carries both rel=alternate links and /tags/web/ carries those plus the two tag feeds. Server stopped afterwards, lsof -nP -iTCP:3000 empty.

Documentation: a Feeds section in packages/cms/README.md (URL table, what each format carries, feedSize, caching, the rel=alternate snippet, and the exported builders), the feed routes added to the public-site route table, and a Feeds section plus the feedSize key in themes/default/README.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Atom 1.0 and JSON Feed 1.1 over the recent published posts at the fixed routes /feed.xml, /feed.json, /tags/{tag}/feed.xml and /tags/{tag}/feed.json, built by a new src/web/feeds.ts with an in-house XML escaper and no new dependency, registered before the not-found handler so feeds are never negotiated (doc-3), carrying ETag/Last-Modified with 304 handling through the TASK-6 helpers, with drafts, trashed documents and pages excluded and both feeds advertised by rel=alternate in the default theme (tag archives add their own). Verified by 18 new node:test cases in src/web/feeds.test.ts that parse the Atom output with a strict test-owned XML reader and assert the JSON Feed 1.1 required fields (pnpm test 245/245, pnpm typecheck and pnpm build green), and against the running demo: curl of all four feed URLs, xmllint --noout on the Atom output, a 304 on If-None-Match, a 404 for an unused tag, and the alternate links in the home and tag-archive HTML.
<!-- SECTION:FINAL_SUMMARY:END -->
