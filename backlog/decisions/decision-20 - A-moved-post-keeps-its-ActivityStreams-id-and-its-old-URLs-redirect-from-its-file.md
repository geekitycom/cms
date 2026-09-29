---
id: decision-20
title: >-
  A moved post keeps its ActivityStreams id and its old URLs redirect from its
  file
date: '2026-09-29 00:14'
status: accepted
---
## Context

decision-13 made a post's ActivityStreams id its permalink and had the editor refuse to move a published post, so that a permalink stayed permanent. TASK-127 asks for published posts and pages to be movable, with the old URL redirecting, so that a move no longer breaks inbound links. Mastodon and other servers cannot change the id of an object they already hold: a new id reaches them as a second object (a Delete plus a Create), which loses replies, boosts and likes.

## Decision

When a published or already-announced post moves and its file has no `activitypub.id`, the editor writes the URL it is leaving, absolute on the base URL, as `activitypub.id`. The stored-id path from decision-13 and decision-14 does the rest. An ActivityStreams request at the old URL gets the Article, whose id is the old URL and whose `url` is the new permalink. A browser there gets a 301. Every Update and Delete names that id, so followers get an Update of the same object. Replies addressed to the old id keep attaching, and feeds keep keying the item by it (decision-12). A post that already stores an id keeps it.

The URLs a document leaves are recorded in its file as `redirect_from` (decision-9), and the public site answers each with a 301 to the current permalink, for HTML, `.md` and `.json` alike, but only when no live document holds that URL.

This supersedes decision-13's paragraph that the editor refuses to move a published post. The rest of decision-13 stands.

## Consequences

A moved post has two URLs for good: its id, which is the old URL, and its permalink. If a new document later takes the old URL, browsers and the `.md` and `.json` representations get the new document. An ActivityStreams request there gets the new document when it is a federated post, and the moved post's Article otherwise. A new federated post at a moved post's id would share that id, which the fediverse would treat as one object. This needs the same month and slug, and is accepted as a rare edge rather than guarded.
