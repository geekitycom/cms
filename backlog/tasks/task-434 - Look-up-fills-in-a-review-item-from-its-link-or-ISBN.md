---
id: TASK-434
title: Look up fills in a review item from its link or ISBN
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 01:15'
updated_date: '2026-10-20 02:57'
labels:
  - admin
  - content
milestone: m-40
dependencies:
  - TASK-433
priority: medium
ordinal: 371800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the review form, a Look up button next to the item's ID reads an ISBN, a DOI or a link. It fetches the item's details and fills in the empty boxes. Sources: Open Library for ISBNs, Crossref for DOIs, the MusicBrainz API (with the Cover Art Archive) for MusicBrainz links, and the TMDb API for TMDb links (needs an API key in Settings). For IMDb and any other link, it falls back to the page's own OpenGraph and JSON-LD metadata, as the cited previews for replies and likes already do. Verify each API's terms, keys and rate limits before building.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Look up with an ISBN, a DOI, a MusicBrainz, TMDb or IMDb link, or any other page fills in the title, the by field, the year and the address where the source has them
- [x] #2 Boxes the author has already filled are left alone
- [x] #3 The cover, poster or album art is downloaded into the media library, not linked from the other site, and its alt text is filled in as "<picture kind> for <title>"
- [x] #4 A failed lookup (not found, network error, missing TMDb key) says what happened next to the button, and the form is otherwise unchanged
- [x] #5 The TMDb API key is a setting, and Look up on a TMDb link without one says how to add it
- [x] #6 MusicBrainz requests send a descriptive User-Agent and stay within its rate limit
- [x] #7 Without JavaScript the ID box still saves as typed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/item-lookup/: read an item ID (isbn:, doi:, bare ISBN/DOI, TMDb/IMDb/MusicBrainz/other link) and fetch the item through fetchPublic (SSRF guards, timeout, byte limit): Open Library Books API (jscmd=data) + covers by ISBN (default=false), Crossref /works/{doi} (mailto = signed-in user's email when set), MusicBrainz release-group/release JSON (one request a second, serialized, Geekity User-Agent) + Cover Art Archive front-500, TMDb v3 movie/tv details (credits for director, networks) and /find for IMDb IDs when a key is set, poster from image.tmdb.org/t/p/w500. Any other page (and IMDb without a key) reuses readPage + pageSource and a new JSON-LD creative-work reader beside jsonLdSource.
2. src/admin/item-lookup.ts: fill only empty review boxes (name, by, year, url, season, episode); when the picture box is empty, download the picture with fetchPublic, store it with storeUpload (imagesOnly) into the media library, write its library alt text, and fill the alt box as '<picture label> for <title>'. Failures give one sentence and change nothing.
3. Routes: POST /admin/item-lookup answers JSON for admin/static/item-lookup.js; the editor's Look up is a submit button (name=lookup-item, formnovalidate) joined to the ID box, handled in documents.ts like switch-kind so it works without JS and re-renders with the status beside the button.
4. TMDb key: new settings namespace tmdb (key, secret, data/tmdb.json credential, GEEKITY_TMDB__KEY), panel on Settings > General with save/remove at /admin/settings/tmdb, TMDb attribution line. Look up on a TMDb link without a key names Settings > General.
5. Tests first per AC (fetch stubbed on globalThis.fetch, hostLookup injected), docs (docs/admin.md, settings docs), then build/test/typecheck/lint/format, browser check with Playwright, live check of Open Library + MusicBrainz.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
API terms checked 2026-10-19 from the providers' docs: Open Library asks for a User-Agent with a contact (1 req/s anonymous, 3 identified; covers by ISBN limited to 100 per 5 min per IP; ?default=false gives 404 for a missing cover). Crossref: polite pool via mailto (10 req/s, 3 concurrent) vs public (5 req/s, 1 concurrent). MusicBrainz: 1 req/s average per IP, a descriptive User-Agent required, 503 on excess. Cover Art Archive: /release-group/{mbid}/front-500 answers 307 to archive.org. TMDb v3: api_key query parameter or Bearer read access token; ~40 req/s; free licence is non-commercial, needs the attribution notice, caches at most 6 months. IMDb: answers a server with an AWS WAF challenge (202, empty title), so an IMDb link only works through TMDb /find with a key.

Built: src/item-lookup/item-id.ts (what an ID names) and src/item-lookup/lookup.ts (one source per ID, every request through fetchPublic with its SSRF guards and the Geekity User-Agent; MusicBrainz requests reserved a second apart in-process). Other pages reuse readPage + pageSource + canonicalLink from the reply-context fetcher, plus a new jsonLdWork reader in reply-context/json-ld.ts for Book, Movie, TVSeries, MusicAlbum, VideoGame, Product and other creative works. fetchPublic gained an optional headers option (for TMDb's Bearer token). cited-picture.ts exports imageExtensionOf, now shared.
src/admin/item-lookup.ts fills only empty boxes (name, by, year, season, episode, url), copies the picture into the media library through storeUpload (imagesOnly) when the picture box is empty, writes the library alt text, and fills the alt box as '<REVIEW_KIND_WORDS picture> for <title>' (the source's kind decides the label). POST /admin/item-lookup answers JSON for admin/static/item-lookup.js; the Look up button is a submit button (name=lookup-item, formnovalidate) handled in documents.ts beside switch-kind, so it works without JavaScript and re-renders with nothing saved. The status sentence is #editor-item-lookup-status (role=status).
TMDb key: settings namespace tmdb (key, secret) in data/tmdb.json (credential), GEEKITY_TMDB__KEY; panel 'Movies and TV shows' on Settings > General with POST /admin/settings/tmdb (save / action=remove), shows only the last four characters and TMDb's attribution line. Crossref requests carry the signed-in user's email as mailto when the user has one.
Boundary tests updated: layer map places item-lookup/ in services; clock allowance for the MusicBrainz spacing; registry and data-census tests list tmdb.

Verification: src/admin/item-lookup.test.ts (17 tests, fetch stubbed on globalThis.fetch, hostLookup injected) and src/item-lookup/item-id.test.ts; mutation checks: removing the empty-box rule fails the 'leaves every box' and no-JS tests, setting the MusicBrainz interval to 0 fails the rate test. pnpm build, pnpm test (cms 6298 pass; plugin-wordpress 123 pass after the census fix), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Live: lookUpItem against the real Open Library (Piranesi), MusicBrainz (In Rainbows), Crossref (Deep learning) and IMDb (WAF challenge, failure message names the TMDb key). Browser (Playwright, fresh site on :3434, stopped after): ISBN and MusicBrainz lookups filled the boxes and copied the real cover and album art into content/uploads with media.json alt text; typed boxes kept; TMDb link without key showed the red sentence and changed nothing; an album review saved with the copied art; no-JS context filled the form on Look up; the settings panel rendered. TMDb itself was not live-checked: no key on this machine. Its responses are stubbed in the tests from TMDb's documented shapes.

Known gap, not in the criteria: each Look up press copies the picture again, so pressing it twice for the same item leaves two library files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Look up on the review form reads the item ID (ISBN, DOI, MusicBrainz, TMDb or IMDb link, or any page), asks Open Library, Crossref, MusicBrainz + Cover Art Archive, TMDb, or the page's JSON-LD/OpenGraph through the existing SSRF-guarded fetcher, fills only the empty boxes, and copies the cover/poster/album art into the media library with '<picture> for <title>' alt text. Works with and without JavaScript; failures are one sentence beside the button. The TMDb key is a new secret setting (tmdb.key, data/tmdb.json, GEEKITY_TMDB__KEY) on Settings > General. Verified with stubbed route tests, the full suite, a Playwright run against a live server, and live calls to Open Library, MusicBrainz and Crossref; TMDb was not live-checked (no key).
<!-- SECTION:FINAL_SUMMARY:END -->
