---
id: TASK-432
title: >-
  A post can be a review of a book, movie, TV show, album, place or anything
  else
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 01:15'
updated_date: '2026-10-20 01:57'
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
- [x] #1 Front matter can describe a review: the item kind, name, by (author, director, network or artist), year, ID, address, picture and its alt text, a date for the kind (finished, watched, listened, visited), season and episode for TV, address fields and website for a place, a free-text "what is it" for place and other, and an optional rating from 1 to 5
- [x] #2 Post type discovery reports a review for a post with a reviewed item
- [x] #3 The post page renders the item with its picture beside its details, the rating as stars with a text equivalent such as "4 out of 5", and the review text, marked up as h-review with p-item, p-rating and p-best
- [x] #4 A review with no rating renders without stars and is still a valid h-review
- [x] #5 Feeds and the fediverse copy say what was reviewed and the rating in plain text, and carry the item picture
- [x] #6 A place review shows the author photos as post photos, separate from the item
- [x] #7 Micropub can create and read back a review (`h=review` or the equivalent properties), and q=source returns the stored properties
- [x] #8 An invalid rating (not a whole number from 1 to 5) is refused with a message naming the field
- [x] #9 doc-2 and the docs describe the review front matter with an example per kind
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. content/review.ts: REVIEW_KINDS (book, movie, tv, album, place, other), reviewOf(extra) reading top-level `item` (kind, name, by, year, uid, url, photo {url, alt}, date, season, episode, category, street-address, locality, region, country-name) and `rating` (whole number 1-5), reviewFrontMatter, isRating, and reviewHtml(): the p-item (h-cite, h-card for a place) with its picture beside its details and the rating as stars plus 'Rated N out of 5' (p-rating, p-best).
2. content/review-form.ts: ReviewForm, REVIEW_FIELDS, submitted/read/resolve (refuse a bad rating naming Rating, a name-less item, a bad kind, url or picture), Micropub item<->form (h-cite/h-card/h-product/h-item; kind inferred from h-card as place) and toProperties.
3. Wire the post type: PostType + discoverPostType ('review' after reply, before photo, so a place review with photos stays a review), PluginPostType, DRAFT_NOUNS, OBJECT_TYPE_OF, POST_TYPES (q=config), REVIEW_FIELD in POST_FIELDS, EditorForm/blankForm, write.ts check, MicropubType 'h-review' (create accepts h=review; micropubType reads it back).
4. Editor: a Review collapse with per-kind fields in editor.njk, GROUPS.review in editor-layout, choices in documents.ts, preview.ts.
5. Theme: context.review {kind, item, rating, html}, partials/review.njk before the content, article h-entry h-review, kicker 'Review', listing shows it, CSS for the picture beside details and stars.
6. Feeds: review HTML (absolute picture) before photos; summary starts with it. Federation: review HTML in the Note, the item picture as an Image attachment. Webmention: the item url is a target.
7. Tests first per AC; docs: doc-2 and docs/ (micropub, theme context, federation) with an example per kind.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Front matter: top-level `item` (map: kind, name, by, year, uid, url, photo {url, alt}, date, season, episode, category, street-address, locality, region, country-name) and `rating` (whole number 1-5), named after the h-review's own properties. One shape for every kind; REVIEW_KIND_FIELDS says which fields a kind has, and a field a kind lacks is ignored on read and dropped on save. Unknown kind reads as other; the editor offers it back as (not recognized) and refuses to save it. A key inside `item` the CMS does not model is kept on save. Unquoted YAML dates (a Date, or its ISO string in the index) read as the calendar day; the editor writes the day quoted.
Post Type Discovery: review sits after reply and before photo, so a place review with the author's photos stays a review. A titled review federates as a Note (OBJECT_TYPE_OF review: Note).
Rendering: content/review.ts reviewHtml is the one renderer for page, feeds and federation (as readLine was): p-item h-cite (h-card for place), picture in .review-picture beside 'Review of NAME (kind, year), by-phrase BY', details line (season/episode, address, 'Watched on 18 October 2026'), then .review-rating with aria-hidden stars and 'Rated N out of 5' as p-rating/p-best. Page article is 'h-entry h-review' (keeps h-entry tooling working); listings too. Feed summary starts with reviewSummary (plain text) unless the post has a description; context.summary is unchanged so listings do not repeat it. Federation attaches the item picture before the photos. Webmention sends to the item url (or web uid).
Micropub: h=review (and h-entry with item) accepted; item is h-cite/h-card/h-product/h-item/h-adr or a name string; item props name, author(by), published(year), uid, url, photo, category, address fields, plus kind, date, season, episode. Without kind, h-card/h-adr is place, else other. q=source answers type h-review with item and rating; an update to any property of a review sources item and rating too (typeProperties, generalised from eventProperties). Author location is now answered for h-review as for h-entry.
Editor: one Review collapse after Event with every field and per-kind hints; TASK-433 replaces it.
doc-2: replaced the stale read-of/read-status rows (TASK-431 left them) with item/rating rows and examples per kind; docs/content.md has a Reviews section with an example per kind; micropub.md, feeds.md, federation.md, theme/template-context.md updated.
FEED_ITEM_REVISION not bumped: feed output changes only for posts with an item, which no existing post has.
Validation: pnpm build, pnpm test (6262 pass; one later run had the cli-jobs reload flake, which passed on rerun), pnpm test:11ty, typecheck, lint, format:check all pass. Curled a demo server on :3497 with a movie and a TV review: page is h-entry h-review with p-item/p-rating/p-best and stars, the unrated one has no stars, /feed/json/ summaries say what was reviewed and the rating.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reviews are a post type. Front matter `item` (kind book/movie/tv/album/place/other plus per-kind fields) and an optional `rating` 1-5 make a post a review under Post Type Discovery (after reply, before photo). One renderer (content/review.ts) gives the page, feeds and fediverse the same p-item h-cite/h-card with its picture, stars plus 'Rated N out of 5' (p-rating, p-best 5); unrated reviews print no stars. Feeds carry the picture absolute and a plain-text summary; the ActivityStreams Note attaches the picture first; place reviews keep author photos as post photos. Micropub creates h-review (or h-entry with item), q=source returns item and rating, updates keep them; a bad rating is refused naming the field in the editor (Rating) and Micropub (rating). The current editor has a Review group that round-trips a review. doc-2 and docs/content.md have an example per kind. Verified by new tests (content/review.test.ts, web/review-page.test.ts, micropub/review.test.ts, the editor tests in admin/posts.test.ts, federation/article.test.ts), the full build/test/test:11ty/typecheck/lint/format:check run, and curl against a demo server.
<!-- SECTION:FINAL_SUMMARY:END -->
