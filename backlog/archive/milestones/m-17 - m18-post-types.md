---
id: m-17
title: "M18 Post types"
---

## Description

A post on this site is always an article with a title, and federates as an ActivityStreams `Article` whose body Mastodon throws away. This milestone gives a post a type, derives that type rather than asking the author to declare it, and makes the federated object follow.

The model is Post Type Discovery, a W3C Working Group Note (18 January 2018, ed. Tantek Celik). Its purpose is exactly this problem: "inferring the type of a post from other properties of that post ... a bridge between formats and protocols without explicit post types (e.g. h-entry, jf2, micropub, Atom, RSS) to those with explicit post types (e.g. ActivityPub, AS2)". The algorithm is ordered — event, rsvp, repost, like, reply, video, photo, then the note/article tail — and the order is the point: a reply that carries a photo is a reply, which no single `kind:` enum could express.

Scope is the two cheapest branches, in the order that keeps each one shippable.

TASK-118 stands alone and fixes the reported symptom: a federated post carries no `summary`, and Mastodon builds an Article's body from `name` + `summary` + link, so a post arrives as a bare title and a link.

TASK-119 is the content half — the algorithm as a pure function, and everything downstream of a post with no title: the page, the listings, all three feeds, the admin editor.

TASK-120 is the federation half: the ActivityStreams type follows the discovered type, with an `activitypub.type` front-matter override. It carries the one real trap in the milestone — Mastodon renders a `Note`'s `summary` as a content warning but an `Article`'s as body text, so the summary added in TASK-118 is right for an Article and wrong for a Note.

TASK-121 adds reply posts: `in-reply-to` front matter, `u-in-reply-to` in the markup, `inReplyTo` on the object, and a webmention to the target. It is the IndieMark level-3 bar on the posts axis.

Photo, like, repost, event, rsvp and video are out of scope; DRAFT-1 holds what research already settled about them, and about book reviews.
