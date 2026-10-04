---
id: TASK-254
title: Fill a post's location from the browser in the editor
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 00:09'
updated_date: '2026-10-04 00:38'
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
- [x] #1 The editor's Location block has a 'Use my location' button, present only with JavaScript and the Geolocation API, that fills Coordinates and Accuracy from the browser and opens the block
- [x] #2 A refused, timed-out or unavailable position shows an inline, announced message in the block; the fields stay editable and the form works without JavaScript
- [x] #3 Only the editor page sends Permissions-Policy geolocation=(self); every other response keeps geolocation=() (the anonymous-pages golden file is unchanged)
- [x] #4 Checked in Chromium with a granted and a denied geolocation permission; the reverse-geocoding choice is recorded in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Header: renderEditor, for a post only, sets Permissions-Policy to the site's configured policy with geolocation=() rewritten to geolocation=(self) (allowGeolocation in src/admin/headers.ts). The baseline middleware already leaves a header the handler set alone, so the shared middleware gains no route branch. A site that removed the header gets none; a custom value without geolocation=() is passed through.
2. Markup: the Location block gets a type=button 'Use my location' rendered hidden, and an empty role=status paragraph; the post editor loads admin/static/location.js with defer (pages do not).
3. admin/static/location.js (ES5 shape, like copy.js): returns without navigator.geolocation; otherwise reveals the button; a click calls getCurrentPosition and fills Coordinates as 'lat, lon' (5 decimals) and Accuracy as whole metres, opens the Location details, and says what happened in the status line; refused, unavailable and timed out each get a message there.
4. HTTP tests first: header on post new/edit/refused save, geolocation=() on page editor, dashboard, public page; header absent when configured off; markup present for posts, absent for pages; script served.
5. Chromium via playwright-core: granted (fills, opens, status) and denied (status message, fields untouched), screenshots; JS-off check that the button stays hidden.
6. Record the reverse-geocoding decision in notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The header map is DEFAULT_SECURITY_HEADERS in packages/cms/src/config.ts.

Decision, reverse geocoding: not done. Turning the coordinates into Place, Locality, Region and Country needs a geocoder; every practical one (Nominatim, Google, Mapbox) is a third party, and asking it would send the author's exact position off the site, which decision-29 keeps out of even content/. Those four boxes stay typed by hand; the README's Location on posts section and location.js's header say so.

Header: renderEditor sets Permissions-Policy itself for a post, as the site's configured policy with geolocation=() rewritten to geolocation=(self) (allowGeolocation in src/admin/headers.ts). applyBaseline already skips a header the handler set, so the shared middleware has no route branch. A site that removed the header (securityHeaders 'permissions-policy': false) gets none on the editor either; a custom policy without geolocation=() passes through unchanged. Pages' editor, every other admin screen and every public response keep geolocation=(); anonymous-pages.golden.json is unchanged.

Enhancement: admin/static/location.js (ES5 shape like copy.js, loaded with defer on the post editor only). The button #editor-location-here is rendered hidden and revealed only when navigator.geolocation exists. A click disables it, says 'Finding your location…' in #editor-location-status (role=status), and on success fills Coordinates as 'lat, lon' to 5 decimals and Accuracy as whole metres (the shape location-field.ts parses), opens the Location details, and says the accuracy. Refused (1), unavailable (2) and timed out (3) each get their own sentence in the status line; typed values are left alone. Options: enableHighAccuracy, timeout 20 s, maximumAge 60 s. The button sits inside the Location block after its hint; the open-on-fill covers a block folded while the browser was answering.

Validation: src/admin/editor-geolocation.test.ts (5 HTTP tests: header on post new, post edit and a 400 refused save; geolocation=() on page editor, dashboard, posts list and a public post; nothing added when the header is removed, custom policy passed through; hidden button, status line and script for posts, none for pages; location.js served). Mutation check: dropping the post-only condition fails the first test on /admin/pages/new. pnpm build && pnpm test (3914 + 30 pass), typecheck, lint, format:check all clean. Chromium 1234 via playwright-core 1.56 against a sandbox site on localhost:4799: granted with setGeolocation(48.858372, 2.294481, accuracy 23.6) fills '48.85837, 2.29448' and '24', status says about 24 metres, fields stay editable, a programmatic click while Location is folded opens it, Publish reads the values back; on /admin with the permission granted getCurrentPosition is refused with code 1 (policy holds there); without a grant the status line gives the refusal message and a typed '51.5, -0.12' is kept; stubbed codes 2 and 3 give their messages; JavaScript off and a context with navigator.geolocation undefined both leave the button hidden, and a typed location saves. Screenshots: geolocation-granted.png, geolocation-denied.png, geolocation-timeout.png, geolocation-no-js.png in the session scratchpad. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The post editor's Location block has a Use my location button. It is rendered hidden and revealed by admin/static/location.js only where the browser has the Geolocation API; it fills Coordinates and Accuracy in the format the server parses, opens the block, and reports a refused, unavailable or timed-out position in a role=status line inside the block. The post editor alone sends Permissions-Policy with geolocation=(self), set by renderEditor from the site's configured policy (allowGeolocation), so the shared header middleware is untouched and every other response, including the anonymous-pages golden file, keeps geolocation=(). Reverse geocoding is not done, because it would send the author's position to a third party. Verified by five HTTP tests with a mutation check, the full build, test, typecheck, lint and format gate, and Chromium runs with granted, denied, stubbed-unavailable, stubbed-timeout, JavaScript-off and no-API contexts. README, package README and the securityHeaders doc updated.
<!-- SECTION:FINAL_SUMMARY:END -->
