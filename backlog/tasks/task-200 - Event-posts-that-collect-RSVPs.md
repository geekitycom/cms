---
id: TASK-200
title: Event posts that collect RSVPs
status: To Do
assignee: []
created_date: '2026-10-01 17:02'
labels:
  - indieweb
  - post-types
  - webmention
dependencies:
  - TASK-198
references:
  - packages/cms/src/content/post-type.ts
  - 'https://indieweb.org/event'
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
- [ ] #1 An event post renders as an h-event with p-name, dt-start, optional dt-end and p-location, and is federated as an Event
- [ ] #2 RSVP webmentions to the event are verified, moderated and shown grouped as going, maybe, interested and not going
- [ ] #3 Fediverse Accept, TentativeAccept and Reject of the Event are shown in the same groups
- [ ] #4 The admin editor can create and edit an event
<!-- AC:END -->
