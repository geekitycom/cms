---
id: decision-13
title: A post's ActivityStreams id is its permalink
date: '2026-09-05 13:15'
status: accepted
---
## Context



## Decision



## Consequences


## Context

doc-4 gave a post two URLs: the permalink, which a reader visits, and `{baseUrl}/ap/posts/{slug}` as the ActivityStreams object id, served by a Fedify object dispatcher and frozen into the post's front matter as `activitypub.id` at first announce. The reason was stability: the editor lets a slug change, a permalink that was never customised follows the slug, and a renamed post was to keep its id so followers were not handed a second object.

On 2026-09-05 the user tested an update and found the id URL answers Not found in a browser, because the dispatcher claims a request only when it asks for ActivityStreams. The permalink already answers such a request with the same Article, so the two URLs serve one object and differ only in which of them the object calls its `id`. Asked whether the id should simply be the permalink, negotiated by `Accept`, the user pointed out that a permalink is by name permanent: the fediverse id is the same promise made to a different audience, and giving the two promises different URLs makes neither stronger. Moving a permalink already breaks every inbound link on the web; a fediverse reply is one more.

## Decision

A post's ActivityStreams object id is its permalink, absolute on the site's base URL. One URL answers a browser with HTML and a peer with the Article, by content negotiation, as the permalink already does. The `/ap/posts/{slug}` object route goes away, and the CMS never mints an `activitypub.id`: the front matter keeps the record that the post was announced and when (`activitypub.published`), which is what delivery needs to choose between `Create` and `Update`.

**A stored id is honoured.** A post whose file already names an `activitypub.id` keeps it as its object id for the life of the post: the CMS serves the object at that URL on an ActivityStreams request, redirects a browser from it to the permalink, and names it in every `Update` and `Delete`. This is what lets a post migrated from WordPress keep the `https://example.com/?p=813` id its followers, its replies and its RSS subscribers already hold (decision-14). A post born on the CMS has no stored id and never sees this path. The id is identity, not cache: it is never dropped, and it is not behind any compatibility setting.

The editor keeps the promise the name makes: a published post's permalink does not change. Renaming a published post's slug, or editing its permalink, is refused with a message saying why. A draft's may still change, since nothing has been promised yet. The date of a published post keeps the day it was filed under, as decision-11 already guarantees.

Supersedes doc-4's "stable, independent of permalink changes" rationale for a separate id. decision-12 is read with this: the id every feed keys a post by is the permalink.

## Consequences

- One URL per post. A shared link, a feed item, an ActivityStreams object and a reply's `inReplyTo` all name the same thing.
- The change is `feat(cms)!`: any post already announced under `/ap/posts/{slug}` is a new object to its followers, and inbox log entries that named the old id no longer attach to the post. Nothing is public yet, so the cost is at its lowest now and would grow with every follower after launch.
- The same rule reaches the actor: decision-14 makes each user an actor whose id is their author URL, and a user record may carry a stored actor id that is honoured the same way. A site in a subdirectory keeps its permalinks under that directory and its object ids follow them, which works because the Article is served by the permalink middleware rather than by a host-rooted dispatcher.
- The Eleventy example config derives `activityStreams` from the permalink rather than from a stored id, and the fixtures follow.
- A rename that a site really wants is the site's own decision, made outside the editor with the knowledge that it breaks a promise. WordPress keeps old slugs and redirects them; that is a separate nicety and not part of this decision.
