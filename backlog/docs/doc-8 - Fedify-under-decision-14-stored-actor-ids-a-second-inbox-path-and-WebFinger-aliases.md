---
id: doc-8
title: >-
  Fedify under decision-14: stored actor ids, a second inbox path and WebFinger
  aliases
type: specification
created_date: '2026-09-13 03:29'
updated_date: '2026-09-13 03:31'
---
The spike for TASK-66. decision-14 asks Fedify for three things its documented
shape does not obviously give, and TASK-68, TASK-69 and TASK-70 are built on
the answers. Everything below was run against **`@fedify/fedify` 2.3.6**,
`@fedify/hono` 2.3.6, `@fedify/vocab` 2.3.6 and `@fedify/cli` 2.3.6, the
versions this repository pins, with throwaway suites that drove the real code
paths: a Hono app, a real `Federation` object, requests signed with
`signRequest`, and a loopback server looked up by `fedify lookup`. The
throwaway code is not merged; what is worth keeping is written out below as
recipes.

## The reference: what andrewshell.org publishes today

WordPress ActivityPub plugin 7.1, read on 2026-09-12:

| Field | Value |
| --- | --- |
| `id` | `https://andrewshell.org/?author=2` |
| `url` | `https://andrewshell.org/author/andrew/` |
| `publicKey.id` / `.owner` | `…/?author=2#main-key` / `…/?author=2` (RSA 2048) |
| `inbox` | `/wp-json/activitypub/1.0/actors/2/inbox` |
| `endpoints.sharedInbox` | `/wp-json/activitypub/1.0/inbox` |
| `outbox`, `followers`, `following` | `/wp-json/activitypub/1.0/actors/2/{name}` |
| `alsoKnownAs` | the stored id, `/author/andrew/`, `/@andrew` |
| WebFinger `subject` | `acct:andrew@andrewshell.org` |
| WebFinger `links[0]` (`self`) | **the stored id**, not the author URL |
| WebFinger `aliases` | the stored id, `/author/andrew/`, `/@andrew` |

A browser at the id gets a 301 to `/author/andrew/`.

## Question 1 — an actor whose stored id is not its dispatcher path

**Fedify serves it natively.** `handleActor` calls the actor dispatcher and
serialises whatever object comes back; it never inspects or rewrites `id`. An
actor dispatcher registered at `/author/{identifier}/` may return a `Person`
whose `id` is `https://example.com/?author=2`, and that is what a peer reads.
`fedify lookup` of the author URL returned a `Person` whose `id` was the stored
id, with no complaint.

**Trailing slashes are fine, and are what decision-14 wants.** A path template
may end in `/`. Registered as `/author/{identifier}/`, with the collections at
`/author/{identifier}/inbox/`, `/outbox/`, `/followers/`, `/following/` and the
shared inbox at `/inbox/`, `ctx.getActorUri`, `getInboxUri`, `getOutboxUri` and
`getFollowersUri` all produce the trailing-slash URLs verbatim. A GET of
`/author/andrew` without the slash is a Fedify 404 that falls through to the
next middleware, which is where the public site's own slash redirect lives.

**Fedify does not take the key id from the document.** `getActorKeyPairs`
builds each `keyId` as `new URL('#main-key', ctx.getActorUri(identifier))` — so
it is always derived from the dispatcher path. With no stored id that is
exactly right: for `/author/{identifier}/` the derived key id is
`{baseUrl}/author/andrew/#main-key`, which matches the actor's own id. With a
stored id it is wrong, and the two fixes are:

1. **In the document**, build the key objects by hand rather than taking
   `keyPair.cryptographicKey` and `keyPair.multikey` from `getActorKeyPairs`:
   `new CryptographicKey({ id: new URL(`${storedId}#main-key`), owner: new URL(storedId), publicKey })`
   and a `Multikey` at `${storedId}#multikey-1` for the Ed25519 pair. (Fedify
   numbers its own multikeys `#multikey-0`, `#multikey-1`, … in
   `ACTOR_KEY_ALGORITHMS` order, so RSA is 0 and Ed25519 is 1.)
2. **When sending**, hand `ctx.sendActivity` an explicit `SenderKeyPair[]`
   instead of `{ identifier }`:
   `[{ keyId: new URL(`${actorId}#main-key`), privateKey: rsaPrivate }, { keyId: new URL(`${actorId}#multikey-1`), privateKey: edPrivate }]`.
   The `Signature-Input` header then names the stored key id
   (`keyid="https://blog.example/?author=2#main-key"`, RFC 9421, which is what
   2.3.6 sends by default) and the body carries a `DataIntegrityProof` whose
   `verificationMethod` is `…/?author=2#multikey-1`.

   Verified end to end: the captured request was replayed through
   `verifyRequest`, which dereferenced the stored id, found the key and
   returned it, and `doesActorOwnKey` then agreed the activity's actor owns it.
   That is precisely the pair of checks a receiving Fedify runs.

   **This costs nothing today**, because the CMS never uses the
   `sendActivity(sender, 'followers', …)` overload — the one overload that
   insists on `{ identifier }`. `delivery.ts` groups the recipients itself so it
   can report per-follower outcomes, and `inbox.ts` and `relays.ts` name a
   single recipient. All three call sites take an explicit key pair array.

**The stored id itself is served by CMS middleware, not by Fedify.** Fedify's
router cannot match a query string, so `?author=2` can never be a dispatcher
path. It is served exactly as `mount.ts` already serves a post's stored
`activitypub.id`: build the candidate as `baseUrl + requestPath + search`,
compare it to the stored id, and then either `respondWithObject(actor, {
contextLoader: ctx.contextLoader })` for an ActivityStreams request or a 301 to
the author archive for a browser. Proven with a `?author=2` id on the site
root: the peer got the `Person`, the browser got `301 → /author/andrew/`, and
`GET /` with no query string still reached the home-page handler untouched.

## Question 2 — a second inbox path for the `/wp-json/` switch

**One `Federation` object cannot have two.** A second
`setInboxListeners(...)` call throws `Inbox listeners already set.`

**`ctx.routeActivity` is not the answer.** Verifying the HTTP signature by hand
with `verifyRequest` and then calling `ctx.routeActivity(identifier, activity,
{ immediate: true })` returned `false` and never reached the listener.
`routeActivityInternal` re-verifies from scratch: it wants an Object Integrity
Proof, or else it dereferences `activity.id` and compares. A Mastodon or
WordPress `Follow` has neither a proof nor a fetchable id, so this path drops
exactly the deliveries the switch exists to catch.

**A second `Federation` object, mounted after the first, works.** Registered on
`/wp-json/activitypub/1.0/actors/{identifier}` with inbox listeners at
`…/actors/{identifier}/inbox` and a shared inbox at
`/wp-json/activitypub/1.0/inbox`, and mounted as a second
`federation()` middleware after the canonical one:

- A `Follow` signed by a peer and POSTed to the personal path returned 202 and
  reached the listener with `ctx.recipient === '2'` — the plugin's numeric
  actor id, straight off the path, which is the mapping TASK-70 needs.
- The same POST to the shared path returned 202 with `ctx.recipient === null`,
  so the listener reads the addressee out of the activity, as the canonical
  shared inbox already does.
- An **unsigned** POST to the same path returned **401**. Signature
  verification happens at the real request path, which is the whole point: no
  rewriting, no forwarding.
- The canonical inbox kept working, and the *first* middleware still owned
  `/.well-known/webfinger` and the actor URL — the second only ever sees what
  the first passed to `next()`.
- `GET` of `…/actors/2`, `…/actors/2/outbox`, `followers` and `following` all
  answered 200 with a `Person` and three `OrderedCollection`s, which is the
  rest of AC #2 on TASK-70 for free.

**Gate it per request, not at boot.** Wrapping the compatibility middleware in
`async (c, next) => (settingIsOn ? compatMiddleware(c, next) : next())` flipped
a `…/actors/2` GET between 404 and 200 with no restart, in both directions.
TASK-70 AC #4 is therefore satisfiable by the "unregisters on the next request"
branch: build the compat federation lazily, and let one gate middleware read
the setting.

**Share one KV store and set `withIdempotency('per-origin')`.** The default
idempotency key is `per-inbox`, which folds the recipient identifier in — so
`andrew` and `2` are different keys and the same `Follow` redelivered to both
paths fired the listener **twice**. With a single `MemoryKvStore` shared by
both federations and `.withIdempotency('per-origin')` on both sets of
listeners, the second delivery was recognised and the listener fired **once**.

## Question 3 — WebFinger aliases

**Fedify's own WebFinger cannot put the stored id in `self`.** The `self` link
is hard-coded to `ctx.getActorUri(identifier)`, the dispatcher path.
`setWebFingerLinksDispatcher` only *appends*: asking it for a `self` produced a
document with two `self` links, the derived one first, which is worse than
either alternative. `aliases` is likewise computed, from the resource and the
actor URI, and cannot be added to.

**`mapAlias` does resolve a lookup by any URL.** A mapper returning
`{ identifier: 'andrew' }` for the stored id, for `/@andrew` and for the author
URL made all three resolve 200. What comes back, though, has the resource as
its `subject` and the author URL as its `self`, which is not what WordPress
publishes.

**So the CMS should own `/.well-known/webfinger`.** A Hono route registered
*before* the Fedify middleware wins outright, and gives complete control of
`subject`, `aliases` and `links`. A hand-written one produced WordPress's exact
document — `subject: acct:andrew@host`, aliases `[stored id, /author/andrew/,
/@andrew]`, `self` the stored id, a `profile-page` link to the archive — and a
loopback `fedify lookup` of both the stored id and the author URL then returned
the same `Person` with the same key.

The route is small: resolve the resource (`acct:{username}@{host}`, the author
URL, `/@{username}`, or the user's stored id) to a user, refuse anything else
with a 404, and answer `application/jrd+json` with
`access-control-allow-origin: *`. The actor document should also carry
`aliases` (which `@fedify/vocab` serialises as `alsoKnownAs`) with the same
three URLs, as the plugin does.

One thing the spike could **not** prove locally: `fedify lookup @user@host`
over loopback. `@fedify/webfinger`'s `lookupWebFinger` always uses `https:` for
an `acct:` resource, so a plain-http loopback host can never be looked up by
handle — with Fedify's own WebFinger handler exactly as much as with a
hand-written one. It is a property of the CLI and of loopback, not of the
design, and the same restriction already shapes `scripts/fed-smoke.ts`. Lookups
by URL work loopback and are what the smoke test should assert on.

## Recommendation, in the shape TASK-68 to TASK-70 need

1. **TASK-68.** Register the actor at `/author/{identifier}/` with the
   collections and shared inbox at the trailing-slash paths decision-14 names.
   With no stored id, Fedify's derived ids and key id are already correct, and
   the actor can be built from `ctx.getActorUri` and `ctx.getActorKeyPairs` the
   way `siteActor` is today. Add one helper — call it `actorId(user)` — that
   answers the stored id when the user has one and `ctx.getActorUri` otherwise,
   and build the key objects and every `sendActivity` sender from it, so the
   stored-id case in TASK-69 is a value change rather than a rewrite. Swap the
   three `sendActivity({ identifier: … }, …)` call sites in `delivery.ts`,
   `inbox.ts` and `relays.ts` for an explicit `SenderKeyPair[]` now.
2. **TASK-68.** Take `/.well-known/webfinger` off Fedify at the same time: one
   Hono route registered before the federation middleware, answering for every
   user. Give the actor `aliases` (`alsoKnownAs`) too.
3. **TASK-69.** Serve the stored id from the same middleware that serves a
   post's stored `activitypub.id` in `mount.ts` — path plus query against the
   base URL, `respondWithObject` for a peer, 301 to the author archive for a
   browser — and add the stored id to the WebFinger route's resolvable
   resources, to its `aliases` and to `self`. Build `publicKey` as
   `{storedId}#main-key` and the multikey as `{storedId}#multikey-1`.
4. **TASK-70.** Build a second `Federation` object for the compatibility paths,
   sharing the canonical one's KV store, with `withIdempotency('per-origin')`
   on both sets of inbox listeners, its actor dispatcher and collections at
   `/wp-json/activitypub/1.0/actors/{identifier}` and its inbox listeners at
   `…/actors/{identifier}/inbox` and `/wp-json/activitypub/1.0/inbox`. Mount it
   after the canonical middleware behind a per-request gate that reads the
   setting, so turning the switch off takes effect on the next request. The
   numeric WordPress id arrives as `ctx.recipient`; map it to a user through the
   field the import sets. Do not try `routeActivity`, and do not try to forward
   or rewrite the request.
