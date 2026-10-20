---
id: TASK-432
title: >-
  A post can be a review of a book, movie, TV show, album, place or anything
  else
status: To Do
assignee: []
created_date: '2026-10-20 01:15'
labels:
  - content
  - micropub
  - theme
milestone: m-40
dependencies:
  - TASK-431
references:
  - _local/editor-mockups/shared/forms.js
  - 'https://microformats.org/wiki/h-review'
  - 'https://indieweb.org/review'
priority: high
ordinal: 369800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add reviews as a post type. A review is about one item and carries an optional 1–5 rating and the review text. The item has a kind (book, movie, tv, album, place, other) and the fields that kind needs. Reviews and their items are stored the same way for every kind, so a later feature can list them by kind and sort them by rating (collection pages).

The item's ID is its canonical address (TMDb, IMDb, MusicBrainz release group, a website). Books and papers can use `isbn:` or `doi:` instead. Nothing invented like `imdb:` or `mbid:`. The item's picture (cover, poster, album art) is the item's, not a post photo. A place review can also carry the author's own photos as ordinary post photos.

Markup follows microformats h-review: `p-item` (an h-cite, or an h-card for a place), `p-rating`, `p-best` 5, `e-content`. Check https://microformats.org/wiki/h-review and https://indieweb.org/review before fixing the front-matter shape. Fields per kind are in the mockup, _local/editor-mockups/shared/forms.js (the review kind).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Front matter can describe a review: the item kind, name, by (author, director, network or artist), year, ID, address, picture and its alt text, a date for the kind (finished, watched, listened, visited), season and episode for TV, address fields and website for a place, a free-text "what is it" for place and other, and an optional rating from 1 to 5
- [ ] #2 Post type discovery reports a review for a post with a reviewed item
- [ ] #3 The post page renders the item with its picture beside its details, the rating as stars with a text equivalent such as "4 out of 5", and the review text, marked up as h-review with p-item, p-rating and p-best
- [ ] #4 A review with no rating renders without stars and is still a valid h-review
- [ ] #5 Feeds and the fediverse copy say what was reviewed and the rating in plain text, and carry the item picture
- [ ] #6 A place review shows the author photos as post photos, separate from the item
- [ ] #7 Micropub can create and read back a review (`h=review` or the equivalent properties), and q=source returns the stored properties
- [ ] #8 An invalid rating (not a whole number from 1 to 5) is refused with a message naming the field
- [ ] #9 doc-2 and the docs describe the review front matter with an example per kind
<!-- AC:END -->
