---
id: TASK-223
title: 'Location on posts: accept Micropub location, store it, render and federate it'
status: To Do
assignee: []
created_date: '2026-10-02 23:44'
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
Quill's note editor can attach the author's current location, and the site refuses it with 400 'This endpoint does not understand location.' (decision-27 refuses what it cannot map). Quill sends a geo: URI string, rounded to five decimal places (about a metre) with an accuracy in metres: 'geo:LAT,LNG;u=ACC' (views/new-post.php:591, set_post_location). Quill only sends it when the author ticks the location checkbox or turns on its location preference. Other Micropub clients send location as an embedded h-geo (latitude, longitude, altitude), an h-adr (locality, region, country-name), or an h-card naming a place with its own geo. TASK-219's Quill inventory lists this gap.

A location is personal data: a post's exact coordinates can reveal where the author lives or is right now. The task starts with a decision on how much of it the site publishes, recorded as a decision document, before the code.

Shape to settle in the decision: one front matter key, location, holding { latitude, longitude, accuracy?, name?, locality?, region?, country? }, parsed at the Micropub boundary from a geo: URI, an h-geo, an h-adr or an h-card, and editable in the admin editor so both paths stay one (decision-27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision records what the site publishes from a location (for example exact, rounded to a precision, place name only, or kept private) and whether that is a site setting, with the default chosen to protect the author
- [ ] #2 Micropub create and update accept location as a geo: URI (with optional ;u= accuracy), an h-geo, an h-adr or an h-card, store it under the location front matter key, and refuse a malformed value with a message naming the problem; q=source returns it
- [ ] #3 The admin editor shows and edits a post's location, and clearing it removes the key
- [ ] #4 The default theme prints the published part of the location inside the h-entry as p-location with h-geo or h-adr markup, honouring the decision; nothing more precise than the decision allows appears anywhere in the page, its JSON-LD, its Markdown or JSON representation, or its feeds
- [ ] #5 Federation carries the published part as an ActivityStreams Place in the object's location, honouring the same decision
- [ ] #6 q=config's per-type property lists (when built) include location for the types that accept it
- [ ] #7 README's Micropub section and the Personal data table document location, and doc-2 documents the front matter key
<!-- AC:END -->
