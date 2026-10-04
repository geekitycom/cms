---
id: TASK-223
title: >-
  Location on posts, and a Settings > Privacy page that decides whether it is
  shown
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 23:44'
updated_date: '2026-10-03 01:29'
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
- [x] #1 A decision records the location sharing choices, the default (collect, publish nothing), and where a kept location is stored given that content/ may be in a public git repository
- [x] #2 Settings > Privacy exists in the admin settings menu and holds the location sharing choice, saved like the other settings pages
- [x] #3 Micropub create and update accept location as a geo: URI (with optional ;u= accuracy), an h-geo, an h-adr or an h-card, keep it where the decision says, and refuse a malformed value with a message naming the problem; q=source returns it to the token's own user whatever the setting
- [x] #4 The admin editor shows and edits a post's location, and clearing it removes it
- [x] #5 With sharing off, no part of a location appears in the page, its JSON-LD, its Markdown or JSON representation, its feeds, its ActivityPub object, or any file under content/ that the site writes; a test searches each for the coordinates
- [x] #6 With sharing on, the theme prints the shared part inside the h-entry as p-location with h-geo or h-adr markup, and federation carries it as an ActivityStreams Place, nothing more precise than the setting allows
- [x] #7 Changing the setting takes effect on the next request for every post, without rewriting posts
- [x] #8 README's Micropub section and Personal data table, and doc-2, document location and the Privacy page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record decision-29: a kept location lives in data/locations.json (mode 0600, keyed by permalink, moved with a renamed post, kept through trash and restore), never in front matter, because content/ may be a public git repository; the sharing levels are none (default, collect and publish nothing), place (words only: name, locality, region, country) and exact (coordinates too); renderers only ever receive a SharedLocation reduced by the setting; an Eleventy build prints no location.
2. src/content/location.ts: PostLocation { geo?: GeoPoint; name?; locality?; region?; country? }, parsed from a geo: URI (RFC 5870, ;u= accuracy), an h-geo, an h-adr or an h-card (nested geo included), from the editor's form fields, and written back for q=source and the form; LOCATION_SHARING levels and shareLocation(location, level) -> SharedLocation | undefined. Unit tests first.
3. src/content/locations.ts: postLocations(dataDir) with read(permalink), set(permalink, location | undefined), move(from, to), atomic under the file lock, written only on change, mode 0600. Unit tests first.
4. Settings: locationSharing on SiteSettings (default none), field location_sharing, validator, read from and written to site.json. New Settings > Privacy page (settings-privacy.ts, pages/settings/privacy.njk, ADMIN_TEMPLATES.settingsPrivacy, SETTINGS_PAGES, menu, __testing__/settings.ts forms, settings-pages.test.ts list). The page also says location and camera metadata is always removed from uploads, naming geekity strip-metadata for older files. HTTP tests first.
5. Editor: EditorForm.location (coordinates, accuracy, place, locality, region, country as strings); formFor takes the stored location; saveFromForm reads the fields for posts; writeDocument parses the form, refuses a bad one by name, and after the save sets the entry under the saved permalink, moving it when the permalink changed; a cleared form removes it. editor.njk gets a Location fieldset. Tests first.
6. Micropub: create.ts accepts location (one value) and fills the form; update.ts lists location in UPDATABLE and sourceProperties answers it from the store whatever the setting (geo URI for coordinates alone, h-adr or h-card otherwise); endpoint.ts passes the store. Tests first, including Quill's geo:LAT,LNG;u=ACC form post.
7. Public surfaces: render.ts takes a location(document) option wired in index.ts from the store and the setting, documentPage puts a reduced location on the context, themes/default/partials/location.njk prints p-location as h-geo, h-adr or h-card inside the entry-meta line; federation/article.ts adds an ActivityStreams Place to the object with only what the level allows. One test sweeps every public surface (page, JSON-LD, .md, .json, rss, atom, json feed, AP object, oEmbed, llms.txt, search, every file under content/) for the coordinates with sharing off, then checks the page and the object with place and exact, and that flipping the setting changes the next request without touching a post file.
8. Docs: README Micropub table, refusal list and Quill paragraph; data/ table and Site settings paragraph; packages/cms README Personal data table; doc-2 Micropub table and a note that location is never in front matter; doc-5 menu table.
9. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; curl the demo site with a Quill-style geo note under each setting; check AC with --check-ac only on proof.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: decision-29 records that a kept location lives in data/locations.json (mode 0600, keyed by permalink, moved with a renamed post, kept through trash and restore) and never in front matter, because content/ may be a public git repository; the levels are none (default), place and exact; renderers receive only a SharedLocation reduced by the setting, whose exact variant alone carries coordinates; an Eleventy build prints no location.

Built: src/content/location.ts (PostLocation, GeoPoint, geo: URI and mf2 parsing, q=source serialising, LOCATION_SHARING, shareLocation), src/content/locations.ts (the private file), src/admin/location-field.ts and the editor's Location fieldset, EditorForm.location through formFor/blankForm/saveFromForm/writeDocument (set, move on a permalink change, clear), Micropub create/update/q=source, the locationSharing setting and Settings > Privacy (settings-privacy.ts, privacy.njk, menu, SETTINGS_PAGES), render.ts location option wired in index.ts, themes/default/partials/location.njk (p-location as h-geo, h-adr or h-card in the entry-meta line), federation Place on the object. Two existing refusal tests that used location as the example of an unmapped property now use checkin and weight.

Verified: unit tests for parsing and the file; HTTP tests in src/micropub/location.test.ts sweep page, .md, .json, rss, atom, json feed, AP object, oEmbed, llms.txt, search and every file under content/ for the coordinates with sharing off, then check the page and the object under place and exact, and that flipping the setting on the Privacy page changes the next request without changing any post file; a mutation that made shareLocation ignore none failed that sweep. Replayed over a real port with curl: Quill-style form create (201, file at mode 0600, nothing under content/), malformed location refused by name, q=source answers the geo: URI with sharing off, Privacy page save flips exact/place/none and the page and AP object follow with the post file's hash unchanged, an unknown value is refused with 400, an h-card create shows in the editor's six fields, an update delete removes the entry.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Location on posts: Micropub create and update accept a geo: URI, h-geo, h-adr or h-card, the editor has a Location box, and the location is kept in data/locations.json (mode 0600, keyed by permalink, moved with the post) and never in front matter (decision-29). Settings > Privacy is a new settings page whose Location on posts choice is none (default), place or exact; renderers get only a SharedLocation reduced by the setting, the theme prints it as p-location (h-geo, h-adr or h-card) and federation as an ActivityStreams Place, and q=source answers the stored location whatever the setting. Verified by unit tests, HTTP tests that sweep every public surface and every file under content/ for the coordinates, a mutation check on the sweep, curl against a real port under all three settings, and pnpm build, test, typecheck, lint and format:check all passing. README, package README and doc-2 and doc-5 updated.
<!-- SECTION:FINAL_SUMMARY:END -->
