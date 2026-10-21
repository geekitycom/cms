---
id: TASK-435
title: A review item can be found by searching its title
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 01:15'
updated_date: '2026-10-20 03:19'
labels:
  - admin
milestone: m-40
dependencies:
  - TASK-434
priority: medium
ordinal: 372800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Above the review item's fields, a "Find the book/movie/show/album/place" box searches by title, so the author does not have to find the link in another tab first. Sources by kind: Open Library for books, TMDb for movies and TV, MusicBrainz release groups for albums, and OpenStreetMap (Nominatim) for places. Picking a match fills the item as Look up does. The mockup shows the result list: _local/editor-mockups/a-picker.html#review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing a title into the find box lists matches from the source for the chosen kind, each with a small picture, the title, by and year (or the address for a place), and the source
- [x] #2 Picking a match fills the ID, details and picture as Look up does
- [x] #3 The list says where to paste a link when the item is not found
- [x] #4 Requests are debounced and respect each source's rate limit and terms; Nominatim gets a User-Agent and at most one request a second
- [x] #5 Other has no find box; the box is absent without JavaScript and the form still works
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/item-lookup/lookup.ts: searchItems(kind, query, options) -> matches {id, name, detail, source, picture}. Open Library search.json (work + best edition; id isbn:… or the edition's address), TMDb /search/movie and /search/tv (by from credits/details of the first few matches), MusicBrainz release-group search through musicBrainzTurn(), Nominatim /search through a one-a-second nominatimTurn(). A small in-memory cache of recent searches so the same query is not sent twice (Nominatim asks for this).
2. Look up learns OpenStreetMap links (parseItemId 'osm' -> Nominatim /lookup), and FoundItem gains the address fields, so a place fills name, street address, locality, region, country and website by the same only-empty-boxes rule.
3. src/admin/item-lookup.ts: GET /admin/item-search?kind=&q= answers the matches with thumbnails fetched as data: URIs (the admin's img-src stays 'self' data:). The lookup endpoint takes an optional item-pick ID: it looks that up instead of the ID box and fills the ID box when it is empty.
4. editor.njk: a 'Find the …' box above #editor-item-lookup for book, movie, TV, album and place, rendered hidden; item-lookup.js shows it, searches on Enter or the Search button (submit-to-search instead of search-as-you-type: Nominatim forbids autocomplete), lists matches from a <template>, and picking one posts the form with item-pick to the lookup endpoint and fills empty boxes. Footer line says where to paste a link; places carry the OSM attribution.
5. Tests first in item-lookup.test.ts (fetch stubbed), docs/admin.md, then build/test/typecheck/lint/format and a Playwright run with JS on and off.

6. (Added after the browser check) Look up reads Open Library edition links through the Books API by OLID, so a book match with no ISBN fills the item too.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- src/item-lookup/lookup.ts: searchItems(kind, query) for book (Open Library search.json with each work's best edition), movie/tv (TMDb /search/movie and /search/tv, plus /movie/{id}/credits or /tv/{id} for the director or network of each of the first six), album (MusicBrainz release-group search through musicBrainzTurn()) and place (Nominatim /search through a new nominatimTurn(), one a second). musicBrainzTurn and nominatimTurn are two instances of one oneASecond() throttle. Successful searches are kept in memory for an hour (100 at most), keyed by kind and lower-cased words, because Nominatim asks results to be cached and blocks repeated queries.
- Look up learned two IDs so a pick can always be looked up: OpenStreetMap node/way/relation links (Nominatim /lookup, filling name, street address, locality, region, country and website) and Open Library edition links (Books API by OLID). FoundItem gained the four address fields and FILLED covers them, so a place follows the same only-empty-boxes rule.
- src/admin/item-lookup.ts: GET /admin/item-search?kind=&q= answers {ok, message, matches[{id,name,detail,source,thumbnail}], credit}. Thumbnails are fetched by the server through fetchPublic and sent as data: URIs, following fetchClientLogo, so the admin CSP stays img-src 'self' data:. POST /admin/item-lookup takes an optional item-pick; it is looked up instead of the ID box and fills the ID box when that is empty.
- editor.njk: the Find box sits above #editor-item-lookup inside forItemKinds(SEARCH_KINDS), so Other has none. It is rendered with the hidden attribute and item-lookup.js unhides it, so without JavaScript it is absent and Look up works as before. The input has no name. Matches are cloned from a <template> so their classes are literal in the template.
- AC#4 'debounced': the box searches on Enter or the Search button, one search at a time, not as the author types. Nominatim's usage policy forbids client-side autocomplete, and a submit-to-search box meets the rate-limit intent of debouncing for every source. Results from OpenStreetMap carry the attribution line 'Places © OpenStreetMap contributors, ODbL.' as the policy asks.
- Fixed in passing: MusicBrainz artist credits lost the spaces in their join phrases ('A & B' came out 'A&B') because the join phrase went through plainText's trim.
- Browser check with a pick of an Open Library match with no ISBN found that its edition link was read as a plain page (title 'X by Y | Open Library', no author). Added the Open Library edition ID to Look up and a test for it.

Validation: pnpm build && pnpm test (cms 6310 pass) && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass. New tests in src/admin/item-search.test.ts with fetch stubbed (no network). Playwright on a scratch site (port 3457, temp content/data) with live Open Library, MusicBrainz and Nominatim: JS on, searched 'piranesi' (6 matches with covers, author · year, Open Library badge, the 'Not here?' line), picked the first and got ISBN, title, author, year, address, cover copied with alt text; album search for 'in rainbows radiohead' listed MusicBrainz matches with art; place search for 'Blue Bottle Coffee Oakland' listed two OSM matches with addresses and the credit line, and picking one with Region typed filled link, name, website, street, locality and country and kept Region; movie without a TMDb key said how to add one; Other hid the box; phone width 390 had no horizontal scroll; a picked review published. JS off: the find box is not visible, Look up by ISBN filled the form, and a review published. Screenshots in the session scratchpad task435/. TMDb search was not checked live: there is no TMDb key here. It is covered by the stubbed tests, built against the documented response fields (results[].id, title/name, release_date/first_air_date, poster_path).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A 'Find the book/movie/TV show/album/place' box above the review item's ID searches Open Library, TMDb, MusicBrainz release groups or Nominatim by title and lists matches with a small picture, title, by · year (or address) and the source, ending with where to paste a link. Picking a match runs Look up on the match's ID (an ISBN, an Open Library edition, a TMDb, MusicBrainz or OpenStreetMap link), which fills the ID and every empty box and copies the picture. Look up now also reads OpenStreetMap and Open Library edition links, and fills a place's address and website. Search runs on Enter or Search rather than as you type; MusicBrainz and Nominatim are held to one request a second, repeat searches come from a one-hour memory, and OSM results are credited. The box is hidden without JavaScript and Look up works as before. New route GET /admin/item-search. Verified with new stubbed tests, the full build/test/typecheck/lint/format run, and Playwright with JS on and off against live Open Library, MusicBrainz and Nominatim (TMDb only through tests, no key here).
<!-- SECTION:FINAL_SUMMARY:END -->
