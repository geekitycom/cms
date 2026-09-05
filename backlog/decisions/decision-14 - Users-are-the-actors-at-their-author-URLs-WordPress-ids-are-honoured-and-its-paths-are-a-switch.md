---
id: decision-14
title: >-
  Users are the actors, at their author URLs; WordPress ids are honoured and its
  paths are a switch
date: '2026-09-05 13:50'
status: accepted
---
## Context



## Decision



## Consequences


## Context

doc-4 made the site one ActivityPub actor at `/ap/actor`. On 2026-09-05 the user said each user should be an actor instead, which is how andrewshell.org is configured: the WordPress ActivityPub plugin (7.1) publishes one author actor and no blog actor. `fedify lookup @andrew@andrewshell.org` showed what its followers hold and what a seamless move to this CMS therefore has to keep:

- Actor id `https://andrewshell.org/?author=2`, with `url` and aliases `/author/andrew/` and `/@andrew`; a browser at the id is redirected to the archive.
- Key id `?author=2#main-key`, RSA 2048.
- Inbox `/wp-json/activitypub/1.0/actors/2/inbox`, shared inbox `/wp-json/activitypub/1.0/inbox`, collections under `/wp-json/activitypub/1.0/actors/2/`.
- Post object ids `https://andrewshell.org/?p=813` with `url` the permalink, and a `replies` collection per post.
- Seven followers, listed in the public followers collection.

Two kinds of thing are in that list. The inbox and collection URLs are **cache**: a follower's server stores them and replaces them the next time it refetches the actor. The actor id and the post ids are **identity**: a follower's server keys the account and every reply by them for as long as it exists, and a document served under one of those URLs with a different `id` reads as a different account or object, not a moved one.

## Decision

**Each user is an actor.** A user's handle is their username, their display name, bio, avatar and links are profile fields on the user, their key pair lives under `data/keys/` named by the user, and their followers and inbound activities are kept per user. Every post is attributed to a user, whose followers receive it. The site actor and its settings go away.

**The actor's id is the author URL**, `{baseUrl}/author/{username}/`, which is the author archive in a browser and the actor on an ActivityStreams request: decision-13 applied to people. Its collections are its children, `/author/{username}/inbox/`, `/outbox/`, `/followers/` and `/following/`, with the author feed at `/author/{username}/feed/` as WordPress serves it. The shared inbox is `/inbox/`. Trailing slashes, as every URL on the site has; only the actor document ever names these, so nothing has to guess the form. `author` and `inbox` are reserved top-level paths.

**A stored id is honoured, for people as for posts.** A user record may carry an actor id it had elsewhere, and a post file an `activitypub.id` (decision-13). The CMS never mints either, serves any it finds at that exact URL on an ActivityStreams request, redirects a browser from it to the pretty URL, and lists it among the WebFinger aliases. Nothing about this is WordPress-specific and none of it is behind a setting: it is identity, and it is kept for the life of the user or the post.

**WordPress's paths are a switch.** A site setting, off by default and never needed by a site born on the CMS, mounts real inbox routes at `/wp-json/activitypub/1.0/inbox` and `/wp-json/activitypub/1.0/actors/{id}/inbox` and the collection routes beside them, mapping the plugin's numeric actor id to the user. Each route records when it was last asked for, and the federation screen shows it, so the owner can see that every follower has refetched the actor and turn the switch off. The CMS does not carry WordPress's URL layout for ever; it carries it until the caches have moved on.

**Retiring a stored actor id is a later, optional step** by the Move protocol: the author URL becomes a new actor listing the old id in `alsoKnownAs`, a Move is sent signed by the old key, and servers that honour Move refollow the new actor. It is not part of the cutover, because not every follower's software honours it.

## Consequences

- `feat(cms)!`: the site actor, `/ap/actor` and the `actorHandle`, `actorType` and avatar settings go away; a site that federated as the site actor starts again as its users. No CMS site is public yet, so nothing is lost.
- The `author` front matter has to name a user, not a free string, for attribution to mean anything; how the existing display-name form maps to a user is the migration's problem to solve, not a reader's.
- Author archives and author feeds exist, which the CMS lacked and WordPress has.
- Fedify derives an actor's id and key id from the path it dispatches the actor at. Serving an actor whose stored id is a query-string URL, and mounting a second inbox path for the switch, are things Fedify may or may not allow directly; a spike settles how before the rest is built.
- The cutover for andrewshell.org is: export the key pair and the followers before DNS moves, import them, set the user's stored actor id, turn the switch on, and turn it off when the federation screen says the caches are quiet. Post ids come in with the content.
- Supersedes doc-4's site actor and the "actor stays at `/ap/actor`" consequence of decision-13.
