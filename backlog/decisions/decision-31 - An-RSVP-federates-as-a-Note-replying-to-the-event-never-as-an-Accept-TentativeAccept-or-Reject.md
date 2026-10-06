---
id: decision-31
title: >-
  An RSVP federates as a Note replying to the event, never as an Accept,
  TentativeAccept or Reject
date: '2026-10-06 03:29'
status: accepted
---
## Context

TASK-198 adds RSVP posts: an `in-reply-to` naming an event and an `rsvp` of `yes`, `no`, `maybe` or `interested`. Post Type Discovery types it `rsvp`, ahead of every other type. The task suggested two ways to federate it: as a `Note` replying to the event, or, when the event is a fediverse object, as an ActivityStreams `Accept`, `TentativeAccept` or `Reject` of the `Event`.

ActivityStreams defines those three as answers to an offer, and its examples accept or decline an `Invite`. Nobody sent this site an `Invite`, and an `Accept` of an `Event` it was never offered is a reply no peer was waiting for. Mobilizon, the fediverse server most events live on, records a participant from a `Join` of the event, which its organiser then accepts, not from an `Accept` sent by the participant. Mastodon shows none of the three. `interested` has no activity at all.

A `Note` with `inReplyTo` is already how a reply federates (decision-18). Mastodon threads it under the event's status, and Mobilizon shows a reply to an event as a comment on it.

## Decision

- An RSVP federates as a `Note` with `inReplyTo` the event, the same object a reply is. `OBJECT_TYPE_OF` maps `rsvp` to `Note`, and `activitypub.type` can still override it.
- Its `content` opens with one line saying what its author will do and linking the event by its name, as a like's does (decision-28): "Going to", "Not going to", "Maybe going to" or "Interested in", then the event. The post's own words follow.
- An event that is a fediverse object is resolved as a reply's target is, so `inReplyTo` names the object's id and its author is mentioned and addressed.
- No `Accept`, `TentativeAccept`, `Reject`, `Join` or `Leave` is sent, and changing or withdrawing an RSVP sends the `Update` or `Delete` any note sends.

## Consequences

- An RSVP reads as a sentence in every fediverse client, and threads under the event wherever the event is a status.
- A Mobilizon event does not count the RSVP as a participant. Doing that would mean sending a `Join` for `yes`, a `Leave` when it changes, and handling the organiser's `Accept` or `Reject` of it: a participation protocol, not a post type. It is left out until somebody needs it, and would be a new decision.
- A post whose front matter carries both an `rsvp` and a `like-of` is an RSVP, so it never sends the `Like` decision-28 would send for a like.
