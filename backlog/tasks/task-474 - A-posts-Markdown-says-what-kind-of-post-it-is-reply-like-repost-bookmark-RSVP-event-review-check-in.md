---
id: TASK-474
title: >-
  A post's Markdown says what kind of post it is: reply, like, repost, bookmark,
  RSVP, event, review, check-in
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 00:22'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/themes/default/partials/reply-context.njk
  - packages/cms/themes/default/partials/event.njk
  - packages/cms/themes/default/partials/review.njk
  - packages/cms/themes/default/partials/rsvp.njk
  - packages/cms/themes/default/partials/location.njk
ordinal: 399800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Post kinds reach Markdown only as raw front matter: in-reply-to, like-of, repost-of, bookmark-of, rsvp, an event's start/end/location as UTC instants, a review's item and rating. A like's Markdown body is empty. The HTML partials print readable lines from the same data: In reply to <cited page>, Liked <page>, RSVP Going to <event>, When/Where in the site's timezone, Review of X (book, 2020) by Y rated 5 out of 5, and the post's location (stored in data/locations.json per decision-29, shared only as Settings > Privacy allows). The Markdown header should print the same lines, linked, with the cited page's name where the HTML has it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reply, like, repost and bookmark posts open their Markdown with a linked line naming what they respond to, using the cited page's title or host as the HTML does
- [x] #2 An RSVP prints its answer and the event it answers; an event prints when (in the site's timezone) and where
- [x] #3 A review prints the item, its kind, year and creator, and the rating
- [x] #4 A post with a location prints only what Settings > Privacy lets the HTML show, and nothing when it shows nothing
- [x] #5 The data is on the Markdown partial context, documented in docs/theme/markdown.md, and tests cover each kind
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In render.ts, add markdownKindContext(document) beside markdownLinksContext: for a post, take postType, lang, rsvp, event and review from documentContext (the HTML's own data), the cited pages from the same citedPage reader citedBy uses, and the location from options.location + locationContext, as documentPage does.
2. Put on the Markdown context: postType, lang, cites (one entry per reply target or citation: verb, url, name from citedPageName, author unless the name already ends 'by <author>', startDate/startZone or published, location, copy for a silo copy), rsvp, event, review (with plain-text link/about/by/uid/details from a new reviewWords in review.ts sharing the HTML's helpers), location.
3. markdown-header.md.njk prints after the title: When/Where for an event, one line per cite, the review line and its details and rating, then Location.
4. Tests in markdown-representation.test.ts first (failing), one per AC: reply/like/repost/bookmark with and without stored context, RSVP + event in a non-UTC zone, review, location under none/place/exact sharing, and a site-theme partial reading each key.
5. Document the keys and the header lines in docs/theme/markdown.md and the header row in docs/public-site.md.
6. Verify with the full pnpm suite and curl against the scratch server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
markdownKindContext(document) in render.ts builds the post-kind data for the Markdown partials beside markdownLinksContext. postType, lang, rsvp, event and review come from documentContext, the same function the HTML's context uses. The cites come from the citedPage reader that citedBy uses, named with citedPageName (shared with postLabel), and dates come from replyContextFor. The location comes from options.location + locationContext, as documentPage does, so Settings > Privacy decides both representations. review.ts gained reviewWords, which gives reviewHtml's words in plain text; itemLink, seasonWords and address are now shared with reviewHtml.
RSVP lines use RSVP_PHRASES ('Going to [event](url)'), the wording postLabel already uses, rather than the HTML's 'RSVP to' plus a separate 'Going' paragraph, so the answer and the event sit on one line. The header prints the lines after the title in the HTML's order: When/Where, cites (plus 'Also in reply to its copy on host' for a silo copy), the review line, its details and rating, then Location.
Tests: 5 new cases in src/web/markdown-representation.test.ts (TASK-474 describe). They cover reply, like, repost and bookmark, a reply to an own-site page, a silo copy, an RSVP, events in a non-UTC zone (place and online), a review, location under none/place/exact, and a site-theme partial that reads each key. The site() helper takes a locations option that writes data/locations.json.
Verified: pnpm build, test (cms 6566/6566), test:11ty, typecheck, lint and format:check all pass. Curled the scratch server (port 3472) with event, RSVP, like, review and located posts under locationSharing place. Each Markdown line matched the HTML cite-line, the event When/Where, review-of and p-location text. The scratch posts were removed afterwards and the server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's Markdown header now says what kind of post it is, from the data its HTML partials use. It prints an event's When/Where in the site's zone, one linked line per reply target, RSVP event, like, repost or bookmark (the cited page's title or 'a page on host', author and dates as the HTML has them), a review's item line, details and rating, and the location only as far as Settings > Privacy shares it. The data (postType, cites, rsvp, event, review, location, lang) is on the Markdown partial context and documented in docs/theme/markdown.md. Verified with new tests per kind, the full pnpm suite, and curl against the scratch server compared with the HTML.
<!-- SECTION:FINAL_SUMMARY:END -->
