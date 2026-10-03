---
id: TASK-236
title: Accept a Micropub checkin as the post's location
status: To Do
assignee: []
created_date: '2026-10-03 16:02'
updated_date: '2026-10-03 16:05'
labels:
  - micropub
  - interop
  - privacy
dependencies:
  - TASK-223
  - TASK-237
references:
  - packages/cms/src/content/location.ts
  - 'https://micropub.rocks/'
priority: low
type: feature
ordinal: 251800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
micropub.rocks server test 204 (run against shll.me on 0.18.0) creates an h-entry with a nested checkin h-card: name, url, latitude, longitude, street-address, locality, region, country-name, postal-code. The site answers 400 'This endpoint does not understand checkin.' (decision-27 refuses unmapped properties). The test asks the endpoint to store the checkin and render the rest of the post. Swarm-style clients send the same shape.

Since TASK-223, a post's location accepts an h-card and is kept privately in data/locations.json, published only as far as Settings > Privacy allows. Map checkin onto it.

Recommended shape, to confirm while building:
- Keep the venue's name, url, coordinates, locality, region and country. Drop street-address and postal-code: under the 'place' sharing level they would publish more than a place name. Record the choice in a decision-27 amendment.
- The location remembers it came from a checkin, so q=source returns it as checkin and an update can replace or delete it as checkin.
- Whether the theme says 'Checked in at <venue>' (the IndieWeb checkin post type) or prints it as an ordinary location is decided in the task; either way it honours the sharing level, so with the default nothing of the checkin is published.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 micropub.rocks test 204's request answers 201, the post's content is published, and the checkin is kept as the post's location
- [ ] #2 q=source returns the checkin as checkin, and update and delete work on it
- [ ] #3 With sharing off, nothing of the checkin appears on any public surface (the TASK-223 sweep test covers it)
- [ ] #4 README's Micropub section and micropub.rocks results, and decision-27, are updated
<!-- AC:END -->
