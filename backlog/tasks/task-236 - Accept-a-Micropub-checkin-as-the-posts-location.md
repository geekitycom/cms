---
id: TASK-236
title: Accept a Micropub checkin as the post's location
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:02'
updated_date: '2026-10-03 17:33'
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
- [x] #1 micropub.rocks test 204's request answers 201, the post's content is published, and the checkin is kept as the post's location
- [x] #2 q=source returns the checkin as checkin, and update and delete work on it
- [x] #3 With sharing off, nothing of the checkin appears on any public surface (the TASK-223 sweep test covers it)
- [x] #4 README's Micropub section and micropub.rocks results, and decision-27, are updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: PostLocation gains checkin?: true, stored in data/locations.json beside the location it marks; a checkin alone is not a location. Keep the venue name, coordinates (h-card latitude/longitude or nested geo), locality, region, country. Drop url, street-address and postal-code: under 'place' they publish more than a place name (a map link carries coordinates), and nothing renders them.
2. location.ts: checkinFromMicropub(value) takes an h-card only and reads it with locationFromMicropub, marking checkin; locationToMicropub answers a checkin as an h-card whatever its words. postLocation/locationOf carry the flag. Unit tests first.
3. create.ts: checkin joins MAPPED_ON_THEIR_OWN and PUBLISHABLE (a Swarm checkin often has no content); one value; with location also sent, the two are one location and the checkin's fields win. update.ts: checkin in UPDATABLE owning the location field; sourceProperties answers a stored checkin as checkin, not location. Tests first, replaying micropub.rocks 204.
4. Editor: LocationForm.checkin, a 'Checked in here' checkbox in the Location fieldset, so an editor save keeps the mark. Test first.
5. Theme and federation unchanged: SharedLocation never sees the mark, so a checkin prints as an ordinary p-location only as far as Settings > Privacy allows. Sweep test: ROCKS_204 with sharing none finds nothing on any public surface or under content/.
6. Move TASK-237's kept-properties tests off checkin onto a property the site still does not understand.
7. Docs: decision-27 amendment, README Micropub table, refusals, q=source, micropub.rocks results, data/ table, Personal data paragraph; package README Personal data table.
8. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; curl a running site with test 204's request.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions (decision-27 TASK-236 amendment): a checkin is the post's location in data/locations.json marked checkin: true. Kept: venue name, locality, region, country, coordinates. Dropped: url, street-address, postal-code, since under 'place' they publish more than a place name (a venue URL may be a map link with coordinates) and nothing renders them. A checkin is publishable without content. A location sent beside a checkin is the same place; the checkin's fields win. The theme prints a checkin as an ordinary p-location: shareLocation never passes the mark on, so readers learn nothing a sharing level does not name. The editor's Location box has an 'A check-in' checkbox so an editor save keeps the mark. checkin is not listed in q=config post-types properties.

Built: content/location.ts checkinFromMicropub, checkin on LocationParts/postLocation/locationOf, locationToMicropub answers a checkin as an h-card; micropub/create.ts maps checkin (MAPPED_ON_THEIR_OWN, PUBLISHABLE, merged with location); micropub/update.ts UPDATABLE checkin owns the location field and q=source answers checkin instead of location; admin/location-field.ts and editor.njk checkbox. TASK-237's kept-properties tests now use an h-food 'ate' and 'rsvp' instead of checkin.

Verified: micropub/checkin.test.ts replays micropub.rocks test 204 (201, content on the page, stored location with checkin: true, no kept-properties file), a content-less checkin, checkin plus location, refusals, q=source round trip, update replace/delete, replace by location, editor save keeping and dropping the mark, the public-surface and content/ sweep with sharing none, and place sharing printing the venue without street, postcode or coordinates. A mutation making shareLocation ignore none failed the sweep ('page holds Los Gorditos'). Replayed test 204's request with curl against a scratch site on port 3917: 201, data/locations.json mode 600 with the checkin, nothing under content/, page shows content and no venue, q=source answers checkin as an h-card, update replace and delete answer 204 and change the file; server stopped. pnpm build, test (3705 + 30 pass), typecheck, lint, format:check all pass. README (Micropub table, Location on posts, refusals, q=source, micropub.rocks results, data/ table, Personal data), packages/cms README Personal data table and doc-2 Micropub table updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub checkin now maps onto the post's location: kept in data/locations.json marked checkin: true, with the venue's name, locality, region, country and coordinates, and never its URL, street address or postcode. micropub.rocks test 204 answers 201 and publishes its content; a checkin needs no content; q=source answers it as checkin and update replace/delete change it; the editor's Location box has an 'A check-in' checkbox. Readers see it as an ordinary location, only as far as Settings > Privacy allows, nothing by default. Recorded in a decision-27 amendment; README, package README and doc-2 updated. Verified by micropub/checkin.test.ts (204 replay, round trip, updates, editor save, public-surface sweep with a mutation check), curl against a scratch site, and pnpm build, test, typecheck, lint and format:check passing.
<!-- SECTION:FINAL_SUMMARY:END -->
