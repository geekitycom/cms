---
id: TASK-434
title: Look up fills in a review item from its link or ISBN
status: To Do
assignee: []
created_date: '2026-10-20 01:15'
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
- [ ] #1 Look up with an ISBN, a DOI, a MusicBrainz, TMDb or IMDb link, or any other page fills in the title, the by field, the year and the address where the source has them
- [ ] #2 Boxes the author has already filled are left alone
- [ ] #3 The cover, poster or album art is downloaded into the media library, not linked from the other site, and its alt text is filled in as "<picture kind> for <title>"
- [ ] #4 A failed lookup (not found, network error, missing TMDb key) says what happened next to the button, and the form is otherwise unchanged
- [ ] #5 The TMDb API key is a setting, and Look up on a TMDb link without one says how to add it
- [ ] #6 MusicBrainz requests send a descriptive User-Agent and stay within its rate limit
- [ ] #7 Without JavaScript the ID box still saves as typed
<!-- AC:END -->
