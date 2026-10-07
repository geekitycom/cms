---
id: TASK-200
title: Event posts that collect RSVPs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:02'
updated_date: '2026-10-07 10:04'
labels:
  - indieweb
  - post-types
  - webmention
milestone: m-28
dependencies:
  - TASK-198
references:
  - packages/cms/themes/default/partials/jsonld.njk
priority: low
type: feature
ordinal: 216800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 5 asks for event posts that receive and display RSVPs. Add an event post: name, start and optional end (in the site's timezone per decision-11), location, and description, rendered as an h-event and federated as an ActivityStreams Event. Incoming RSVP webmentions (p-rsvp yes, no, maybe, interested) and fediverse Accept/TentativeAccept/Reject activities on the event are shown grouped by response with facepiles, using the RSVP handling from TASK-198.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An event post renders as an h-event with p-name, dt-start, optional dt-end and p-location, and is federated as an Event
- [x] #2 RSVP webmentions to the event are verified, moderated and shown grouped as going, maybe, interested and not going
- [x] #3 Fediverse Accept, TentativeAccept and Reject of the Event are shown in the same groups
- [x] #4 The admin editor can create and edit an event
- [x] #5 The default theme's JSON-LD (partials/jsonld.njk, decision-16) describes an event post as a schema.org Event with name, startDate, endDate when set, location (Place with address, or VirtualLocation with url), eventAttendanceMode, eventStatus, description, and organizer referencing the author's Person node, and passes Google's Rich Results Test for events
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: an event is a post whose front matter carries a valid 'start' (mf2 dt-start), with optional 'end' and 'location' beside the title (p-name) and body (e-content). Start and end are UTC instants in the file and are shown in the site zone (decision-11). 'location' is the event's public place: words make a Place, an http(s) URL makes a VirtualLocation. All reads go through a new content/event.ts (EVENT_KEYS, eventOf, EventLocation) the way rsvp.ts holds RSVPs.
1. Post Type Discovery: PostType gains 'event', checked first, ahead of rsvp, as the spec orders it. Tests first.
2. Theme: context gains event {start, end, location}; layouts/post.njk renders an event as article.h-event with p-name, dt-start, dt-end, p-location (h-adr words or a u-url link) via partials/event.njk; kicker says Event. A 'datetime' format joins the date filter so a start shows its time and zone.
3. JSON-LD: partials/jsonld.njk describes an event post as a schema.org Event (name, startDate, endDate, location Place+address or VirtualLocation+url, eventAttendanceMode, eventStatus, description, organizer -> Person @id, url, image). Check against Google's documented required/recommended Event properties.
4. Conversation: Interaction carries rsvp from webmentions (TASK-198) and now from Accept (yes), TentativeAccept (maybe) and Reject (no) logged in the inbox against the event's object id. On an event post, RSVPs leave the reply thread and are grouped as conversation.rsvps (going, maybe, interested, not going), latest answer per person wins, Undo withdraws. conversation.njk prints each group as a facepile. Moderation is the comment intake's as it stands (only approved webmentions are shown).
5. Inbox: TentativeAccept reaches the Accept handler (Fedify walks the class chain); an Accept/Reject whose object is one of the site's posts is not taken as a relay answer.
6. Federation: OBJECT_TYPE_OF maps event to an ActivityStreams Event (name, startTime, endTime, location Place, summary, content); file decision-32 for the event shape, the front matter keys and the inbound mapping.
7. Editor: an Event group with Starts, Ends (wall clock in the site zone) and Location; writeDocument refuses an unreadable start or end, an end before the start, end/location without start, and an event with no title. resolveExtra writes start/end/location; formFor/preview carry them; slug from title.
8. Micropub: POST_TYPES is keyed by the types Micropub can create; h-event create is out of scope (endpoint creates h-entry only), noted as follow-up.
9. Docs: theme README, README, doc-2. Verify build/test/typecheck/lint/format:check and curl a served scratch site; validate the JSON-LD structurally.

Followed as written; decision-32 records the event shape, the front matter keys, the inbound Accept/TentativeAccept/Reject mapping and the relay guard.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: an event is a post with a readable 'start' (content/event.ts: EVENT_KEYS, eventOf, eventLocation, instantOf; PostEvent {start, end?, location? place|virtual}). Post Type Discovery checks it first, ahead of rsvp. start/end are UTC instants in the file, read as UTC when hand-written with no offset; an end before the start is dropped. 'location' is the event's public place in front matter (decision-32 explains the difference from decision-29); the theme context keeps 'location' for the author's shared location and puts the event's under 'event.location'. documentContext now sets location: undefined over the raw front matter spread so a hand-written string never reaches the location partial.
Theme: layouts/post.njk types an event article h-event; partials/event.njk prints dl.event-details with time.dt-start/dt-end (date filter's new 'datetime' format, site zone, zone named, e.g. '10 October 2026 at 09:00 GMT-5') and span.p-location or 'Online at' a.p-location. jsonld.njk prints an Event node instead of BlogPosting: name, url, startDate, endDate, location Place{name,address} or VirtualLocation{url}, eventAttendanceMode, eventStatus EventScheduled, description, image, organizer {@id person} (publisher when no person).
Federation: OBJECT_TYPES gains Event; OBJECT_TYPE_OF event -> Event with name, summary (feed excerpt), content, startTime, endTime, location Place (url for an online one).
Conversation: Conversation.rsvps (groups {value,label,people} in order yes, maybe, interested, no, non-empty only) and counts.rsvps. On an event post, approved webmention replies with an rsvp and inbox Accept (yes) / TentativeAccept (maybe, Fedify routes it to the Accept handler) / Reject (no) of the event's object id are grouped, one per person (actorId, else author url) with the latest answer; Undo by the same actor withdraws. On other posts TASK-198's behaviour stands (RSVP stays in the thread). conversation.njk prints a facepile per group above the reactions. handleAccept/handleReject skip relay matching when the object is one of the site's posts.
Editor: Event group (Starts, Ends, Where) via admin/event-field.ts; wall clock in the site zone; refuses unreadable times, end before start, end/where without start, and an event with no Title. A post that is no event keeps hand-written start/end/location on save. Preview renders the event. editor-layout.test.ts and editor-daisyui.test.ts only gained the new 'Event' group row (and the three empty event fields in the posted form); nothing else in editor-layout.test.ts was touched.
Micropub: POST_TYPES is keyed by Exclude<PostType,'event'>; the endpoint creates h-entry only. Follow-up candidates: Micropub h-event create, and q=source returning start/end/location as h-event.
Validation: pnpm build, pnpm test (4781 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Mutation checks: hiding the RSVP groups in conversation.njk fails the receive and inbox tests; dropping the wasEvent guard fails the hand-written-location test. Served a scratch site from dist on :3919 (no outside hosts) and curled /2026/09/camp/: article.blog-post.h-event; mf2 parse gives h-event name, start, end, location, url; JSON-LD Event with Place+address, Offline mode, EventScheduled, organizer -> /author/ada/#person; Accept: application/activity+json gives type Event with startTime, endTime, Place, summary. Server stopped.
AC #5 left unchecked: the JSON-LD carries everything the criterion lists and is checked by web/event.test.ts, but 'passes Google's Rich Results Test' needs a page Google can fetch (a deployed site) or a run of Google's tool, which is a third-party service this run does not call. Check it after deploy; location.address is a Text address, which schema.org allows; if Google wants a PostalAddress it will warn there.

AC #5 verified after the 0.23.0 deploy: https://shll.me/2026/10/party/ serves an h-event and one JSON-LD Event node (name, startDate, endDate, Place with a Text address, OfflineEventAttendanceMode, EventScheduled, description, image, organizer -> /author/a/#person in the same graph). The operator ran Google's Rich Results Test on that URL and it passed; the Text address was accepted, so no PostalAddress follow-up is needed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added event posts. A post whose front matter has a readable start (with optional end and location) is an event under Post Type Discovery, ahead of RSVP. The default theme renders it as an h-event with dt-start, dt-end and p-location in the site's zone, and its JSON-LD as a schema.org Event (Place with address or VirtualLocation with url, attendance mode, EventScheduled, description, organizer referencing the author's Person). It federates as an ActivityStreams Event. Approved RSVP webmentions and fediverse Accept, TentativeAccept and Reject of the event are grouped on its page as going, maybe, interested and not going, one face per person with their latest answer. The admin editor has an Event group (Starts, Ends, Where). decision-32 records the choices. Verified with tests, the full build/test/typecheck/lint/format:check run, an mf2 parse of a served scratch site, and after the 0.23.0 deploy a passing Google Rich Results Test on https://shll.me/2026/10/party/.
<!-- SECTION:FINAL_SUMMARY:END -->
