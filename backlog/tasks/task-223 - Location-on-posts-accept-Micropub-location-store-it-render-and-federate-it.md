---
id: TASK-223
title: >-
  Location on posts, and a Settings > Privacy page that decides whether it is
  shown
status: To Do
assignee: []
created_date: '2026-10-02 23:44'
updated_date: '2026-10-02 23:47'
labels:
  - micropub
  - interop
  - privacy
dependencies: []
references:
  - 'https://github.com/aaronpk/Quill'
  - 'https://indieweb.org/location'
  - 'https://www.w3.org/TR/activitystreams-vocabulary/#dfn-place'
priority: medium
type: feature
ordinal: 238800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quill's note editor can attach the author's current location, and the site refuses it with 400 'This endpoint does not understand location.' (decision-27 refuses what it cannot map). Quill sends a geo: URI string, rounded to five decimal places (about a metre) with an accuracy in metres: 'geo:LAT,LNG;u=ACC' (views/new-post.php:591, set_post_location). It is optional in Quill: sent only when the author ticks the location checkbox or turns on its location preference. Other Micropub clients send location as an embedded h-geo (latitude, longitude, altitude), an h-adr (locality, region, country-name), or an h-card naming a place with its own geo. TASK-219's Quill inventory lists this gap.

The site accepts and keeps a location, and a new Settings > Privacy page decides whether it is shared. Its first option is location sharing, with a choice that collects the location but publishes none of it, and that choice is the default. Sharing it exactly, or only as a place name, are the other choices (the decision settles the exact set). The Privacy page is where later privacy choices go.

A location is personal data: exact coordinates can reveal where the author lives or is right now. Collecting without sharing has a catch to settle in the decision: front matter lives in content/, which a site may keep in a public git repository, so a location written there is public whatever the setting says. The decision chooses where a kept location lives (front matter, or a private file under dataDir keyed by post, as decision-26 keys syndication copies) with that in mind.

Shape: { latitude, longitude, accuracy?, name?, locality?, region?, country? }, parsed at the Micropub boundary from a geo: URI, an h-geo, an h-adr or an h-card, and editable in the admin editor so both paths stay one (decision-27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision records the location sharing choices, the default (collect, publish nothing), and where a kept location is stored given that content/ may be in a public git repository
- [ ] #2 Settings > Privacy exists in the admin settings menu and holds the location sharing choice, saved like the other settings pages
- [ ] #3 Micropub create and update accept location as a geo: URI (with optional ;u= accuracy), an h-geo, an h-adr or an h-card, keep it where the decision says, and refuse a malformed value with a message naming the problem; q=source returns it to the token's own user whatever the setting
- [ ] #4 The admin editor shows and edits a post's location, and clearing it removes it
- [ ] #5 With sharing off, no part of a location appears in the page, its JSON-LD, its Markdown or JSON representation, its feeds, its ActivityPub object, or any file under content/ that the site writes; a test searches each for the coordinates
- [ ] #6 With sharing on, the theme prints the shared part inside the h-entry as p-location with h-geo or h-adr markup, and federation carries it as an ActivityStreams Place, nothing more precise than the setting allows
- [ ] #7 Changing the setting takes effect on the next request for every post, without rewriting posts
- [ ] #8 README's Micropub section and Personal data table, and doc-2, document location and the Privacy page
<!-- AC:END -->
