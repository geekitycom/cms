---
id: TASK-474
title: >-
  A post's Markdown says what kind of post it is: reply, like, repost, bookmark,
  RSVP, event, review, check-in
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
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
- [ ] #1 Reply, like, repost and bookmark posts open their Markdown with a linked line naming what they respond to, using the cited page's title or host as the HTML does
- [ ] #2 An RSVP prints its answer and the event it answers; an event prints when (in the site's timezone) and where
- [ ] #3 A review prints the item, its kind, year and creator, and the rating
- [ ] #4 A post with a location prints only what Settings > Privacy lets the HTML show, and nothing when it shows nothing
- [ ] #5 The data is on the Markdown partial context, documented in docs/theme/markdown.md, and tests cover each kind
<!-- AC:END -->
