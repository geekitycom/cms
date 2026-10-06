---
id: decision-32
title: >-
  An event is a post with a start, federates as an ActivityStreams Event, and
  collects RSVPs from webmentions and from Accept, TentativeAccept and Reject
date: '2026-10-06 03:47'
status: accepted
---
## Context

TASK-200 adds event posts, IndieMark level 5: a post that announces an event and shows who is coming. Post Type Discovery types a post as an event when it is an h-event, ahead of every other type. A Markdown file has no microformat type, so something in its front matter has to say "this is an event". The event also needs a shape on the fediverse, and the site has to decide which incoming answers count as RSVPs to it.

decision-31 already settled the other direction: this site's RSVPs to somebody else's event go out as a `Note` replying to the event, never as an `Accept`, `TentativeAccept` or `Reject`. Incoming answers are a different question, because a peer that sends one of those three about an event here means it as an RSVP whatever the vocabulary's examples say.

## Decision

- **An event is a post with a readable `start`.** The front matter uses the mf2 names an h-event uses: the title is `p-name`, the body is the description, and `start`, `end` and `location` sit beside them. `start` is the property an h-event cannot do without, so a readable `start` is what makes the post an event. Post Type Discovery checks it first, ahead of `rsvp`, as the spec orders the types. `content/event.ts` is the only reader.
- **Times are UTC instants** (decision-11). The editor's Starts and Ends fields are wall-clock time in the site's zone, like the Date field, and the file holds the instant ending in `Z`. A time written by hand with no offset is read as UTC. An `end` before its `start` is ignored, and the editor refuses it.
- **`location` is the event's place, in front matter.** decision-29 keeps the author's own location out of front matter because it is private. An event's place is the opposite: an event is announced so that people can go to it. A web address is where to join an online event, and any other words name the place. The author's location under decision-29 is unchanged and stays in `data/locations.json`. In the theme context it stays `location`, and the event's place is `event.location`.
- **The page is an h-event**, not an h-entry, with `dt-start`, `dt-end` and `p-location`. The JSON-LD entry node is a schema.org `Event` in place of the `BlogPosting`. Its `location` is a `Place` whose `name` and `address` are the words, or a `VirtualLocation` with the `url`. It also carries the matching `eventAttendanceMode`, `eventStatus` `EventScheduled` (the CMS has no cancelled or moved event), and an `organizer` that references the author's Person node.
- **It federates as an ActivityStreams `Event`**, added to `OBJECT_TYPES` and mapped from `event` in `OBJECT_TYPE_OF`. It carries `name`, `summary` (the feed excerpt, as an `Article` does), `content`, `startTime`, `endTime` and `location`. The `location` is a `Place` named by the words, or named by the address and carrying it as its `url`. Mastodon shows an `Event` as its name, summary and link, as it shows an `Article`. These are the properties ActivityStreams defines for an event, and the ones Mobilizon reads. `activitypub.type` can still override the type.
- **Incoming RSVPs to an event are grouped**, as going, maybe, interested and not going, in that order.
  - A webmention reply that carries a `p-rsvp` (TASK-198) joins its group once a moderator approves it, as every webmention is moderated.
  - From the fediverse, an `Accept` of the event's object means going, a `TentativeAccept` means maybe, and a `Reject` means not going. ActivityStreams has no activity for interested.
  - Each person is counted once, with their latest answer. An `Undo` by the same actor withdraws the answer.
  - On an event, an RSVP leaves the reply thread. On any other post, a webmention RSVP stays in the thread with its `p-rsvp`, as TASK-198 shows it.
  - Groups are read from the comment index and the inbox log, so no new storage was needed.
- **An `Accept` or a `Reject` whose object is one of the site's posts is never taken as a relay's answer** to a subscription, however its sender's host matches a pending relay.
- **Micropub does not create events.** The endpoint creates h-entry posts, and an event is an h-event, so `q=config` does not offer one. `POST_TYPES` is keyed by every type except `event`.

## Consequences

- A site can announce an event from the editor, and anybody can answer it from their own site or from a fediverse account. The answers show on the page as facepiles.
- A Mastodon user has no button that sends an `Accept`. Mastodon users answer by replying, and that reply shows in the thread, not in a group. Mobilizon sends a `Join` for participation, which is not handled (decision-31 leaves the participation protocol out in both directions). Software that does send `Accept`, `TentativeAccept` or `Reject` of an `Event` is counted.
- A `start` key written by hand into a post makes it an event. That key was never meaningful to the CMS before, so no existing post changes type unless it already carried one. A hand-written `start`, `end` or `location` on a post that is not an event is left alone by an editor save.
- The `date` filter gains a `datetime` format, which shows the day and the time with the zone named.
- An event created through Micropub, and an event's `start` in `q=source`, are left for later.

## Amendment (2026-10-06, TASK-280)

Micropub creates events. The bullet "Micropub does not create events" no longer holds.

- **The type decides what `location` means.** A create names `h-event` or `h-entry`. On an `h-event`, `start` and `end` fill the editor's Starts and Ends, and `location` fills Where: the event's public place, in front matter. On an `h-entry`, `location` is still the author's own location in `data/locations.json` (decision-29). `checkin` is the author's own on either type, because a checkin says where the author was, not where the event is.
- **The editor's rules, not a second set.** The event fields go through `resolveEvent` in the editor's write path (decision-27). An unreadable time, an end before the start, and an event with no name come back with the editor's messages. A `start` with no offset is the site's zone, as the editor's Starts field and Micropub's `published` are. Without this, a Quill user who leaves its zone box empty would have a start in UTC, not their own time.
- **What is refused.** An `h-event` with no `start` is refused, so a client never gets an article where it asked for an event. An `h-entry` with `start` or `end` is refused and pointed at `h-event`, rather than made an event whose `location` means the author's location. A `location` that is a `geo:` URI is refused on an event, since it has no words to show.
- **An h-card or h-adr place becomes words.** Front matter holds the place as words or a web address. An h-card or h-adr is written as its `name`, `street-address`, `locality`, `region` and `country-name` joined by commas, without repeats, or as its `url` when it names none. Its coordinates are dropped. A place is not stored as an object, because the theme, the JSON-LD and the ActivityStreams `Place` all read the words.
- **Bare JSON values.** Quill's event editor sends `location`, `content` and `end` as bare values, not lists. A JSON create now reads any bare value as a list of one. The alternative, refusing them, refused every event Quill sends.
- **Read and update.** `q=source` answers an event as `type: ["h-event"]`, with `start` and `end` as the stored UTC instants and `location` as the place's words or address. A create takes that answer back as the same event. The author's own location on an event is answered only when it is a checkin, because `location` already names the event's place. An update to `start`, `end` or `location` on an event changes the event, and keeps the other two as they were. Deleting `start` is refused, since it would turn the post into something other than an event; the editor can still do that. A `start` or `end` sent in an update to a post that is no event is refused, as on a create.
- **`q=config`** offers the `event` type, with `start`, `end`, `name` and the common properties, requiring `start` and `name`. `POST_TYPES` is keyed by every `PostType`.
