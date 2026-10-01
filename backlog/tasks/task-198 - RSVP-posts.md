---
id: TASK-198
title: RSVP posts
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
updated_date: '2026-10-01 17:04'
labels:
  - indieweb
  - post-types
  - webmention
milestone: m-28
dependencies: []
references:
  - packages/cms/src/content/post-type.ts
  - 'https://indieweb.org/rsvp'
priority: low
type: feature
ordinal: 214800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks to publish RSVP posts and send webmentions to events. PostType is reply | note | article. Add an RSVP post: in-reply-to an event URL plus rsvp yes, no, maybe or interested, rendered as an h-entry with p-rsvp and a reply context for the event (its name, start date and location), with the webmention sent to the event. Post type discovery puts rsvp ahead of reply. Federate it as a Note replying to the event, or as an ActivityStreams Accept/TentativeAccept/Reject of an Event when the target is a fediverse event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with in-reply-to and rsvp renders as an RSVP with p-rsvp and the event's reply context
- [ ] #2 Publishing it sends a webmention to the event URL
- [ ] #3 Post type discovery reports rsvp for it, and the admin editor can create one
- [ ] #4 Incoming RSVP webmentions on posts are shown as RSVPs rather than generic replies
<!-- AC:END -->
