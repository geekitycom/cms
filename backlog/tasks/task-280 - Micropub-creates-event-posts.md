---
id: TASK-280
title: Micropub creates event posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 03:54'
updated_date: '2026-10-06 11:48'
labels:
  - micropub
  - indieweb
milestone: m-28
dependencies:
  - TASK-200
references:
  - packages/cms/src/micropub/endpoint.ts
priority: low
type: feature
ordinal: 239800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since TASK-200 a post with a start is an event (h-event), made in the admin editor. The Micropub endpoint creates h-entry posts only, so a client such as Quill cannot publish an event, and q=source returns an event as an h-entry without its start, end or location. Accept h=event with start, end, location, name and content, and give them back from q=source.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub create with h=event and a start makes an event post as the editor would
- [x] #2 q=source of an event returns h-event with its start, end and location
- [x] #3 q=config offers the event post type
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a Micropub create names its type, and the type decides what the properties mean. h-entry stays as it is. h-event is a post with an event: start and end fill the editor's Starts and Ends (an offset-less time is the site's zone, as published is), location fills Where, and everything else maps as for h-entry. checkin stays the author's own location (decision-29) on either type.
1. create.ts: accept h-event; start/end/location -> form.event, validated by the editor's resolveEvent through writeDocument. An h-event with no start is refused; an h-entry with start or end is refused (send h-event). location for an event: a string (words or an http(s) URL) or an h-card/h-adr reduced to words (name, street-address, locality, region, country-name) or its url when it names nothing; geo dropped.
2. fromJson: a bare value is one value, since Quill's event editor sends location, content and end unwrapped.
3. update.ts: an event post is updated as an h-event: start, end and location own the event fields, and touching one carries the others from the source so they are not wiped. sourceProperties answers start, end and location (the event's place) for an event; q=source answers type h-event.
4. endpoint.ts: POST_TYPES keyed by every PostType; event offered with start, end, name, location and the common properties; required name and start.
5. Tests first for each AC: create.test (form and JSON, editor byte-equality), quill.test (Quill's event editor request), post-types test (q=config), update/source tests.
6. Docs: README Micropub table, q=config, q=source, Quill paragraph; doc-2 Micropub section; decision-32 amendment.
7. Verify build/test/typecheck/lint/format:check and curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: the create's type decides what the properties mean. h-event: start/end fill the editor's Starts/Ends (form.event), location fills Where (the event's public place, decision-32), checkin stays the author's own location (decision-29); the form goes through writeDocument, so resolveEvent and the no-title refusal are the editor's. h-entry is unchanged, except that start/end on it are refused and pointed at h-event (they had been kept privately).
Choices: an offset-less start/end is the site's zone, as published and the editor's Starts are. An h-event with no start is refused (otherwise it would silently become an article). An h-card/h-adr location becomes words (name, street-address, locality, region, country-name joined with ', ', no repeats) or its url when it names nothing; coordinates dropped; a geo: URI is refused for an event. JSON bare values are read as one value: Quill's event editor (views/event.php, fetched from GitHub) sends location, content and end unwrapped, so without this every Quill event was refused.
Read/update: q=source answers type h-event with start, end (UTC instants) and location (the place); the author's location on an event is answered only when it is a checkin. updateForm reads an event as h-event; start, end and location own the event field (EVENT_UPDATABLE), and all three are read from source whenever the post is an event, so changing one keeps the others. Deleting start is refused (needs a start); start/end on a post that is no event is refused. A hand-written geo: location on an event would make every Micropub update of it refused; an edge left as is.
q=config: POST_TYPES keyed by every PostType; event offers start, end, name and the common properties, requires start and name.
Docs: README (create table h=event/start/end/location (event), bare JSON values, update, q=config, q=source, Quill), doc-2 Micropub section via backlog doc update, decision-32 amendment (2026-10-06, TASK-280). decision-27's table still lists h-event among refused types; the decision-32 amendment supersedes it.
Validation: new src/micropub/event.test.ts (23 tests: editor byte-equality in America/Chicago, form h=event, offset-less start, checkin vs place, h-card/h-adr/url places, refusals, q=source, properties[], round trip, updates); quill.test.ts replays Quill's event editor requests (looked-up place, typed place with no zone, empty place); post-types.test.ts and endpoint.test.ts cover q=config. Mutation: dropping the event-sibling read in updateForm fails 3 update tests. pnpm build, pnpm test (4817 + 30 pass), typecheck, lint, format:check clean. Curled a scratch site from dist on :3927: Quill-shaped JSON h-event and form h=event answered 201; file has start/end UTC and the place words; q=source answered h-event with start/end/location; q=config lists event; update replace start answered 204 and kept end/location; pages are article.h-event with dt-start and p-location (or the online link). Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub creates events. A create with h=event (form or JSON) and a start is written through the editor's write path as the editor's Event group would write it: start and end as UTC instants (an offset-less time in the site's zone), location as the event's public place in front matter, with an h-card or h-adr reduced to its name and address words; checkin stays the author's own private location. The editor's event refusals apply, and an h-event without a start, or an h-entry with start or end, is refused. q=source answers an event as h-event with start, end and location, and an update changes any of them while keeping the others. q=config offers the event type. JSON bare values are read as one value so Quill's event editor works. Verified with new and extended tests (event, quill, post-types, endpoint), the full build/test/typecheck/lint/format:check run, and curl against a served scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
