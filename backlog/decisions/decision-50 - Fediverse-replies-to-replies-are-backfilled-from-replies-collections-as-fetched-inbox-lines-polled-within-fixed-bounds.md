---
id: decision-50
title: >-
  Fediverse replies to replies are backfilled from replies collections as
  fetched inbox lines, polled within fixed bounds
date: '2026-10-10 17:52'
status: accepted
---
## Context

Someone who answers a fediverse reply on one of our posts addresses the person
they answer, so their reply never reaches our inbox. Most servers, Mastodon
among them, list a note's replies in its `replies` collection, an
OrderedCollection or Collection with first and next pages. FEP-7888 `context`
collections exist, but few servers publish them.

Fediverse replies are already the inbox log: `ap_inbox` rows, read back by
`replyFrom` and gathered by `web/conversation.ts`. That log gives threading,
counts, `/replies/` keys, feeds and Delete/Undo withdrawal. Reading
collections is polling, so it needs bounds and has to stay off the
page-render path.

## Decision

- **Storage.** A reply found in a collection is an inbox log line like a
  delivered one: a synthetic `Create` with id `{note id}#fetched`, its actor
  the note's `attributedTo`, its object the compacted note, marked
  `"fetched": true` (the `ap_inbox.fetched` column, admin migration 25). The
  conversation reading is unchanged.
- **Schedule.** A timer every hour, signed as the first account through
  `siteLoaders`. Only served posts dated within the last 30 days, each thread
  at most every 6 hours.
- **Bounds.** The collections of visible fediverse replies down to 4 levels
  below the post, at most 3 pages each, 30 seconds per note and collection.
- **Filters.** Kept only when it answers the listing note, is addressed to
  `as:Public`, and is attributed to an actor on the note's own origin. The
  site never fetches its own origin.
- **One note, one row.** The sweep skips notes already held, and a delivery
  replaces a fetched line.
- **Removal.** A fetched reply, with the fetched replies under it, is removed
  when its server answers 404 or 410, or when a collection read to its end no
  longer lists it. Delivered replies are never removed by the backfill.
  Errors, a missing collection, and a collection cut off by the page limit
  change nothing.
- The site reads `replies`, not `context`.

## Consequences

- Fetched replies are moderated, withdrawn, counted, fed and shown on the
  federation screen exactly like delivered ones. A future block or
  defederation filter in the inbox log's reading path covers both.
- The inbox log is no longer only what the inbox was told. Lines marked
  fetched are what the site read.
- A thread with many fediverse replies costs one note fetch plus up to 3 page
  fetches per reply every 6 hours, for 30 days.
- A collection that is never read to its end never drops anything. A reply
  under a delivered note that later disappears stays until its author's
  Delete arrives.
- A reply is attributed to its own server's actor, so a page cannot attribute
  words to someone on another server.
- Like reply contexts and actor profiles, the backfill is a read, so dev mode
  does not hold it.
