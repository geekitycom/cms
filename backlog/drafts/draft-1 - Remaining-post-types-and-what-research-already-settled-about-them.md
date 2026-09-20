---
id: DRAFT-1
title: 'Remaining post types, and what research already settled about them'
status: Draft
assignee: []
created_date: '2026-09-20 21:01'
labels: []
dependencies:
  - TASK-120
references:
  - 'https://www.w3.org/TR/post-type-discovery/'
  - 'https://codeberg.org/fediverse/fep/src/branch/main/fep/e229/fep-e229.md'
  - 'https://github.com/bookwyrm-social/bookwyrm/blob/main/FEDERATION.md'
  - >-
    https://socialhub.activitypub.rocks/t/modeling-a-movie-review-in-activitystreams/3822
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A holding record for the post types not yet scoped, and for research already done so it is not repeated. Split into real tasks when each is picked up.

## Remaining branches of the Post Type Algorithm

**photo** (AS2 `Image`) — needs ActivityPub media attachments, of which the CMS currently has none: `postArticle` emits no `attachment` at all, and the only attachment code anywhere is the actor's profile links in `federation/actor.ts`. Carries a verified tradeoff: Mastodon's `FetchLinkCardService` bails with `return if ... @status.with_media?`, so an object with attachments gets media thumbnails but **loses** the OpenGraph link-preview card scraped from the page. With good `og:image`/`og:description`, no attachment may look better.

**like** (AS2 `Like`) and **repost** (AS2 `Announce`) — architecturally different from everything above. These are *activities*, not objects, so the outbox and delivery would emit something other than `Create`/`Update`/`Delete` for the first time. Expect this to touch `federation/delivery.ts` and the outbox, not just the object mapper.

**event** (`Event`) and **rsvp** (Accept/Reject/TentativeAccept of an Event) — need an event content model (`startTime`, `endTime`, `location`). Least trodden for a blog. Note AS2 has no RSVP type; granary maps rsvp to `Accept`/`Reject`/`TentativeAccept` of an `Event`, which is clean and lossless.

**video** (`Video`) — as photo, heavier.

## Book reviews — researched, deliberately deferred

Reviews have **no standard representation in any federation vocabulary**, verified across four independent checks:

- AS2 core has no `Review` or `Rating` type and no rating property. The full type list is Article, Audio, Document, Event, Image, Note, Page, Place, Profile, Relationship, Tombstone, Video.
- No FEP covers reviews or ratings. All 143 were grepped full-text; `ratingValue|reviewRating|itemReviewed|reviewBody` returns zero hits, and the only `rating` hit is FEP-eb22 quoting BookWyrm. The one attempt at a vocabulary-registration process, FEP-2e40, is withdrawn.
- Post Type Discovery has no review type.
- granary — the de facto mf2-to-AS2 bridge — has zero handling of `h-review`, `review`, `rating`, `p-best` or `p-worst`, and no test fixture. An h-review falls through to article/note.

**BookWyrm** uses a private extension: a custom `Review` type (subclass of `Comment`) with a required, non-null, dereferenceable `inReplyToBook`. Verified from source: BookWyrm HTTP GETs that URL with a signed request and requires JSON deserialising to an `Edition`; anything else — an Amazon page, any HTML — means `resolve_remote_id` returns `None`, the NOT NULL FK is never set, and **the entire status is rejected**, with no degrade to a plain Note. Its `@context` is only `["https://www.w3.org/ns/activitystreams", {"Hashtag": "as:Hashtag"}]`, which defines none of its terms, so `inReplyToBook`, `rating` and `Edition` all expand to meaningless blank nodes. `fedify lookup` on a BookWyrm book returns nothing but an `@id`. BookWyrm issue #1132 proposes moving to a namespaced `bw:` form; a documented but unshipped v1.0 vocabulary exists at `https://www.w3id.org/BookWyrm/ns#`.

**NeoDB**, the only other reviews implementation, invented its own incompatible extension (`relatedWith` carrying `Rating`/`Review`) rather than reuse BookWyrm's — `grep inReplyToBook` across NeoDB returns zero matches — and has the identical undefined-terms defect.

Both use **schema.org `Review` in the HTML page's JSON-LD only, never in the ActivityPub payload.** Two independent implementations converging on that split is the strongest signal available.

There is also a type fork with no straddle today: sending `type: "Review"` gets into BookWyrm but Mastodon rejects it outright as an unsupported object type, so the post would vanish; sending `Article` is read by everything except BookWyrm, whose `naive_parse` explicitly bails on inbound Articles. BookWyrm resolves this by serialising per recipient, which Fedify's delivery does not do.

Conclusion reached: if reviews happen, federate as an ordinary `Article` with the rating folded into `name` (BookWyrm's own degraded form does exactly this, which is why their reviews read well on Mastodon), put schema.org `Review` in the HTML JSON-LD, identify the book by ISBN rather than by any instance-specific URL, and treat BookWyrm threading as a separate feature if ever wanted.

## Standing principle worth keeping

Any custom property this CMS puts on the wire gets a declared JSON-LD namespace, or it does not go on the wire. BookWyrm and NeoDB both got this wrong and their extensions are invisible to conforming parsers. FEP-e229 gives the recommended patterns; the one proven precedent that survives expansion is Mastodon's `schema`/`PropertyValue` in its actor context.
<!-- SECTION:DESCRIPTION:END -->
