---
id: TASK-254
title: Fill a post's location from the browser in the editor
status: To Do
assignee: []
created_date: '2026-10-04 00:09'
updated_date: '2026-10-04 00:09'
labels:
  - admin
  - privacy
dependencies: []
priority: medium
type: feature
ordinal: 269800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The editor's Location block (Coordinates, Accuracy, Place, Locality, Region, Country; TASK-223, folded in a details block by TASK-245) is typed by hand. Add a 'Use my location' button that asks the browser for its position with navigator.geolocation (desktop and mobile browsers both support it; it needs HTTPS, which the admin already requires in production) and fills Coordinates and Accuracy, opening the block. Progressive enhancement: the button appears only when scripting and the Geolocation API are available, the fields stay hand-editable, and a refusal, timeout or unavailable position shows an inline message in the block rather than an alert.

The site sends Permissions-Policy: geolocation=() on every response (SECURITY_HEADERS in packages/cms/src/config.ts), which makes the browser refuse the API outright. The editor page, and only it, needs geolocation=(self); public pages and every other admin page keep geolocation=().

Reverse geocoding (turning coordinates into Place, Locality, Region and Country) would send the author's position to a third party such as Nominatim. It is out of scope here unless done without one; record the choice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The editor's Location block has a 'Use my location' button, present only with JavaScript and the Geolocation API, that fills Coordinates and Accuracy from the browser and opens the block
- [ ] #2 A refused, timed-out or unavailable position shows an inline, announced message in the block; the fields stay editable and the form works without JavaScript
- [ ] #3 Only the editor page sends Permissions-Policy geolocation=(self); every other response keeps geolocation=() (the anonymous-pages golden file is unchanged)
- [ ] #4 Checked in Chromium with a granted and a denied geolocation permission; the reverse-geocoding choice is recorded in the task notes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The header map is DEFAULT_SECURITY_HEADERS in packages/cms/src/config.ts.
<!-- SECTION:NOTES:END -->
