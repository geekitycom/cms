---
id: doc-4
title: ActivityPub Federation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-20 15:56'
---
# ActivityPub Federation

Federation is implemented with Fedify (`@fedify/fedify` 2.x) mounted into Hono through `@fedify/hono`. **Every user is an actor** (decision-14); the site is not one. Every published post is an `Article` created by the actor of the user its `author` names.

## Actors

- One actor per user, at their author URL: `{baseUrl}/author/{username}/`. That URL is the author archive in a browser and the `Person` on an ActivityStreams request — decision-13 applied to people, so an actor id is a URL that already means something.
- Handle: `@{username}@{host}`. There is no handle setting: a login is unique, and an id a settings field could move would be a different account to every follower holding it.
- Type: `Person`, always. A user is a person, and there is nothing left for the old `actorType` setting to choose between.
- Profile fields come from the user's profile in `data/users.json`: `name` is the display name (their username when they have written none), `summary` the bio, `icon` the avatar, `attachment` the links as `PropertyValue`s. `preferredUsername` is the username, `url` the archive, `manuallyApprovesFollowers` false, `discoverable` and `indexable` true.
- `alsoKnownAs` lists every URL the person answers to: the actor id, the archive and `/@{username}` — three URLs when the id is a stored one, two when the id is the archive.
- Collections are the archive's children: `/author/{username}/inbox/`, `/outbox/`, `/followers/` and `/following/`, with the author feeds at `/author/{username}/feed/` as WordPress serves them. The shared inbox is `/inbox/`. `author` and `inbox` are reserved top-level paths.
- `/@{username}` is a 301 to the archive.
- Key pairs (RSA-PKCS#1-v1.5 and Ed25519) are generated on first need and stored as JWK files under `data/keys/`, one per algorithm per user, named after the username (`ada.rsassa-pkcs1-v1_5.jwk`, `ada.ed25519.jwk`) and written `0600` in a `0700` directory. Each file holds the private key alone; the public half is derived from it. Fedify's `setKeyPairsDispatcher` reads them, and every user's files are checked at boot: one that is there and will not import stops the boot rather than being replaced, because regenerating would change that person's identity and every follower's cached public key would stop verifying, and Fedify answers a throwing key pairs dispatcher with an actor document that has no `publicKey` at all, which peers would cache.
- The actor publishes the RSA key as `publicKey` with id `{actor}#main-key`, and both pairs as `assertionMethod` multikeys at `{actor}#multikey-0` and `#multikey-1`. The key objects are built by hand from the actor's id rather than taken from `getActorKeyPairs`, whose ids Fedify derives from the dispatcher path (doc-8); every outgoing activity is signed with an explicit `SenderKeyPair[]` built from the same id, so what a signature names is always what the document publishes.
- `src/federation/actor.ts`'s `actorId(context, user)` is the single place an actor's id is decided: the stored id where the user record carries one, the author URL otherwise. Everything built from it — the key ids, the multikeys, `alsoKnownAs`, the `actor` of every activity, the sender key pairs, WebFinger's `self` — follows from that one function.

### A stored actor id

A user record may carry an `actorId`: the ActivityStreams id that person was published under somewhere else, such as the `https://example.com/?author=2` the WordPress ActivityPub plugin publishes. It is identity rather than cache (decision-14) — a follower's server keys the account by it, and a document served under it with a different `id` reads as a different person rather than as the same one moved — so the CMS keeps it for the life of the user. This is the rule a post's `activitypub.id` follows, done for people.

- The CMS never mints one, and no screen writes one: it arrives with `geekity import wordpress-actor` or is typed into `data/users.json` by hand. A value that is not an absolute `http`/`https` URL is dropped on the way in rather than refused, and that user is served under their author URL as before.
- The actor document's `id` is the stored id, its `publicKey` is `{storedId}#main-key` and its multikeys `{storedId}#multikey-0` and `#multikey-1`. `url` is still the archive, and the collections are still the archive's children: those are cache, and a peer refetches them.
- That exact URL — path **and** query string, matched against `baseUrl` — answers with the `Person` on an ActivityStreams request and with a 301 to the author archive on any other. It is served by CMS middleware ahead of the public site, not by Fedify, whose router cannot match a query string (doc-8), and by the same middleware that serves a post's stored `activitypub.id`. Every other request for that path is untouched: `/` is still the home page, and so is `/?author=9`.
- WebFinger lists it first among the `aliases`, publishes it as the `self` link, and resolves a lookup by it; the actor document carries the same three URLs as `alsoKnownAs`.
- Every activity the user sends names it as `actor` and is signed with a key id under it, so a peer that dereferences the key id finds the document that owns it. A `Follow` addressed to the stored id is accepted as a follow of that user, and the `Accept` comes from the stored id too.
- The users screen shows a stored id read-only beside the account, and the federation screen shows it as the actor's id, because it is what a peer gets.
- Retiring one is a later, optional step by the Move protocol, and is not part of a cutover.

The site actor and `/ap/` are gone. A site that federated as the site actor starts again as its users: its `actor.*.jwk` key files are left on disk, unread, and the old `content/_data/federation/followers.json` is left where it is. Neither is migrated, because a follow is an agreement with somebody and there is no honest answer to which user inherits an account that no longer exists.

## WordPress ActivityPub compatibility

A site that moved here from the WordPress ActivityPub plugin has followers whose servers still hold the plugin's endpoints: `/wp-json/activitypub/1.0/actors/{n}/inbox`, the shared `/wp-json/activitypub/1.0/inbox`, and the collections beside them. decision-14 calls those **cache rather than identity** — a follower's server replaces them the next time it refetches the actor — so the CMS carries them behind a switch, until the caches have moved on and no longer.

- The switch is the `wordpressActivityPub` setting, on Federation > Settings (`/admin/federation/settings`). Off by default, and absent from `site.json` until somebody turns it on: a site born here never needs it, and turning it off again takes the key back out.
- A user is mapped to one of the plugin's numeric actor ids by `wordpressActorId` on their record in `data/users.json` — the WordPress user id, a whole positive number. `geekity import wordpress-actor` sets it beside the stored actor id; no screen writes it. A user without one is not reachable through any of these paths.
- With the switch on, the CMS serves real inbox routes at `…/actors/{n}/inbox` and `…/1.0/inbox`, signature-verified at the request path exactly as the canonical inboxes are — an unsigned or badly signed delivery is a 401 — and GET routes for the actor and its `outbox`, `followers` and `following` at `…/actors/{n}/`.
- **What a peer reads back is always the canonical identity.** The `Person` served at `…/actors/{n}` is the same document the author URL serves: the same `id` (the stored actor id, or the author URL), the same `publicKey`, and the *canonical* `inbox`, `outbox`, `followers` and `following`. A peer refetching the actor at the old URL is exactly the peer that should learn the new endpoints, and that is what eventually makes the switch safe to turn off. An `Accept` sent from one of these inboxes comes from the canonical id and is signed with the key under it.
- Under the hood this is a second Fedify `Federation`, mounted after the canonical middleware behind a per-request gate that reads the setting. One `Federation` may have exactly one pair of inbox listeners, and `ctx.routeActivity` re-verifies in a way a Mastodon or WordPress `Follow` cannot satisfy (doc-8). The two objects share one KV store and both set `withIdempotency('per-origin')`, because Fedify's default key folds the recipient identifier in — so the same `Follow` redelivered to `ada` and to `2` would be handled twice. The second object is built the first time a request reaches one of the paths with the switch on.
- Because the gate is per request, **turning the switch off takes the paths away on the very next request**, with nothing restarted, and turning it on puts them back.
- Every one of the paths records the instant it was last asked for, per user, in `data/wordpress-activitypub.json` — a file, so a deleted database (decision-9) does not forget the one question the switch is watched by. Federation > Settings lists each path beside the switch with that instant, or never, and the note that once every follower's server has refetched the actor the switch can come off.

### The cutover, and the command that does it

`geekity import wordpress-actor <username>` brings one person across: the RSA
key pair their followers have cached, the actor id those followers key the
account by, the plugin's numeric actor id, and the followers themselves. It
takes `--actor-id` (the URL WordPress published, query string and all),
`--wordpress-id`, and the key pair as either `--keypair` (the JSON in the
plugin's `activitypub_keypair_for_{login}` option) or `--private-key` and
`--public-key` as PEM (the legacy `magic_sig_private_key` / `magic_sig_public_key`
user meta); both PEM encodings are read. The public key is checked against the
private half and then thrown away, because it is derived. `--followers` points
at a URL, a saved collection file, or `none`; left off it is the plugin's own
public collection on the actor id's origin, which the plugin answers as an
`OrderedCollection` whose page lists bare actor URLs, so each follower costs one
dereference. A follower that cannot be fetched is reported and skipped.

It is idempotent: run twice it writes nothing and says so, because a follower
already in the file keeps its place and its follow time and a key file already
holding that key is left alone. A user who already has a *different* key pair is
refused unless `--force`, since importing over one would change that person's
identity and every follower has cached the public half of the key that is there.
No screen writes any of this; `src/federation/import-wordpress.ts` is the only
door, and `setUserWordPressActor` in `src/admin/accounts.ts` the only writer of
the two ids.

The checklist for a site leaving the plugin:

1. **Export** while the old site is still up: the key pair, and optionally the
   followers collection. Note the actor id and the numeric actor id. Bring the
   content across; the post ids come with it (decision-13).
2. **Import** with `geekity import wordpress-actor`, then read the report and
   re-run for any follower whose server did not answer.
3. **Switch on** the `wordpressActivityPub` setting, then move the DNS, so the
   deliveries still aimed at the plugin's inbox paths land.
4. **Watch** Federation > Settings, which dates each compatibility path, and
   Federation > Followers, which shows each user's actor id and followers. The dates
   go quiet as each follower's server refetches the actor.
5. **Switch off** once the paths have been quiet for long enough. It takes
   effect on the next request, and turning it back on is just as quick.

Retiring the stored actor id by the Move protocol is a later, optional step, and
is not part of the cutover.

## WebFinger

`/.well-known/webfinger` is the CMS's own Hono route, registered before the Fedify middleware. Fedify's own hard-codes the `self` link to the dispatcher path and computes `aliases` from the resource, and neither can be added to (doc-8), so the CMS owns the document: `subject` is `acct:{username}@{host}`, `aliases` are the actor id, the archive and `/@{username}`, `links` are `self` (the actor id, `application/activity+json`) and `profile-page` (the archive, `text/html`). It answers for the `acct:` handle, the bare `{username}@{host}`, the author URL, `/@{username}` and the user's stored actor id when they have one; anything else is a 404. `application/jrd+json`, with `access-control-allow-origin: *`.

## Objects

Each non-draft post maps to an `Article`:

- `id`: the post permalink, absolute on `baseUrl` (decision-13). One URL for both audiences: a browser asking for HTML gets the page and a peer asking for ActivityStreams gets this object, served by the permalink middleware rather than by a host-rooted dispatcher, so a site in a subdirectory keeps that directory in its ids. There is no `/ap/posts/{slug}` route.
- `url`: the same permalink
- `name`: title
- `content`: rendered HTML
- `source`: `{ content: markdown, mediaType: "text/markdown" }`
- `published`, `updated`
- `attributedTo`: the actor of the user the post's `author` names
- `to`: `Public`, `cc`: that user's followers collection
- `tag`: one `Hashtag` per tag

Which user that is follows TASK-67's one rule: a username exactly, else a display name exactly one user answers to. A post whose `author` names nobody the site knows is announced by the site's first account, which is the only actor that can be chosen without guessing between people — but it is on nobody's outbox, because an outbox is the author archive as activities and the archive is the same query.

Pages are not federated.

A post whose front matter already names an `activitypub.id` keeps it as its object id for the life of the post, and the CMS never mints one. That is what lets a post migrated from WordPress keep the `https://example.com/?p=813` its followers, its replies and its RSS subscribers already hold (decision-14): the CMS serves the `Article` at that URL on an ActivityStreams request, redirects a browser from it to the permalink, and names it in every `Update` and `Delete`. The match is on the whole URL, so a stored id with a query string works exactly as one with a path. A user's stored actor id, above, is the same rule for people.

Because the id is the permalink, the permalink is a promise to two audiences at once, and the editor keeps it: renaming a published post's slug, or editing its permalink, is refused. A draft's may still change.

## Delivery

| Event | Activity |
| --- | --- |
| post becomes non-draft (new file, or `draft` flips to false) | `Create(Article)` |
| non-draft post content or title changes | `Update(Article)` |
| post becomes draft, is trashed, or file deleted | `Delete(Article)` with a `Tombstone` |
| a user's profile is saved on the users screen | `Update` of that user's actor |

The sync layer emits the post events from index diffs, so editing a file on disk federates the same way an admin save does. A post is delivered to **its author's followers** and to every accepted relay, each recipient grouped into the inbox one POST reaches (shared inbox when available). Nothing on the settings screen is anybody's profile any more, so no save there tells anybody anything. The `activitypub.published` front-matter key records that a post has been announced and when, which is what decides `Create` against `Update` and what a restore reuses. It is the only key a delivery writes.

Every `sendActivity` call site — the fan-out in `delivery.ts`, the `Accept` in `inbox.ts` and the relay `Follow`/`Undo` in `relays.ts` — hands Fedify an explicit `SenderKeyPair[]` rather than `{ identifier }`. That is what lets an actor sign under an id Fedify did not derive (doc-8), and it costs nothing today because none of the three uses the `sendActivity(sender, 'followers', …)` overload: `delivery.ts` groups the recipients itself so it can report per-follower outcomes, and the other two name a single recipient.

No activity is stored (decision-9). What SQLite keeps about anything the site has sent is one outcome row per recipient — the activity's id, type, object id and slug, the follower or relay, the inbox used, how it went, why not, and when — which is a cache and is allowed to be empty. That is what the federation screen reads to say how a post last landed.

## Relays

A Mastodon-style relay (FEP-ae0c) boosts every public activity it is sent on to the instances subscribed to it, which is how a small site reaches people who follow nobody on it. Fedify ships the relay *server* half only, so the client half is ours.

- The relay list is a setting, `relays`, one inbox URL per line, edited on Federation > Settings (`/admin/federation/settings`) and stored in `site.json` like every other setting (decision-9). `https://tags.pub/user/_____relay_____/inbox` is the one this site uses.
- Adding a relay sends a `Follow` whose `object` is the literal Public collection (`https://www.w3.org/ns/activitystreams#Public`) to that inbox, signed by **the site's first account**: a relay subscription is an instance-wide agreement rather than one person's, and the first account is the one actor that can be chosen without asking. Fedify attaches the Linked Data signature a Mastodon-style relay verifies.
- The relay answers `Accept` or `Reject`, possibly days later: a subscription may need a human to approve it. The answer is matched to the subscription by the follow id, then by the relay's actor id, then by a single pending subscription on the answering actor's origin.
- Removing a relay sends `Undo` of that `Follow` and drops the record.
- Only an accepted relay is delivered to, whoever wrote the post, and its outcome is recorded in the delivery log against its actor id and its inbox, exactly as a follower's is. Resend therefore reaches relays for free.
- The subscription records live in `ap_relays` in SQLite, keyed by inbox. They are operational state derivable from the file: a relay the settings name that has no record is followed again on the next boot.
- Announces the relay sends back arrive in the inbox log like any other boost.

## Inbox

Handled in phase one:

- `Follow`: store the follower under the user the activity named, reply `Accept` as that user.
- `Undo(Follow)`: remove the follower from that user.
- `Delete` of an actor: remove the follower from every user it followed.
- `Accept` and `Reject`: the answer to a relay subscription, which is the only thing this site follows.

A delivery may arrive at a user's own inbox or at the shared `/inbox/`; Fedify verifies the HTTP signature at whichever path it was posted to. At the personal inbox the addressee is the identifier in the path; at the shared one it is read out of the activity, which is what `parseUri` decides for a `Follow`.

Logged but not acted on: `Like`, `Announce`, `Create(Note)` replies. Every handled activity, the follow traffic included, is appended to `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` — one compact JSON-LD activity per line, prefixed with the `receivedAt` the log stamped it with and the `recipient` it was addressed to, which are the two things the activity cannot say for itself. The log stays one chronological record, because it is a record of what this server was told. The whole activity is kept so a later phase can surface likes, boosts, and comments without knowing in advance what it will want. The `ap_inbox` table is an index of that file, rebuilt from it on every boot: its columns — the activity id, type, actor, object, recipient, arrival time and the `in_reply_to` a `Create` named — are all derived from the line by one function that the live append and the rebuild both call, so a rebuilt row cannot say something the live one did not. That `in_reply_to` index is what the conversation reader below — and through it the comments feeds (doc-3) — reads.

## The conversation on the page

The inbox log is also what a reader sees, and `src/web/conversation.ts` is the one module that reads it for them. `createConversation({ admin, store, baseUrl })` returns the reader, and it answers exactly three questions: `thread(document)` is everything said about one post, `counts(documents)` is how many answers each of a list of posts has, and `latest(limit)` is the site's newest answers with the post each is about. `thread` returns a `Conversation`: the replies as a thread, and the likes, boosts and mentions as counts with the people behind them. The renderer puts it on the post's template context as `conversation`, and only when there is something in it, so a post nobody has answered renders no empty section; `themes/default/partials/conversation.njk` is the section, and a site replaces it through the ordinary theme lookup. The whole shape is documented in the theme README under "The conversation".

Nothing about that shape is ActivityPub's. An entry says where it came from (`source`, `"activitypub"` here) and what it is (`kind`, one of `reply`, `like`, `boost`, `repost` or `mention`), and everything else — the author, the sanitised content, the time, what it answers — is the same whatever produced it, so native comments and webmentions join the same thread rather than needing one of their own. Both do exactly that: the reader merges the `comments` index with the inbox one, the approved comments are threaded in by the same `inReplyTo` rule, and a post that has never been delivered — and so has no object id at all — still has a conversation, hanging off its permalink instead. doc-6 is the comments half and doc-7 the webmentions half. The last two kinds are the webmention vocabulary's: a `repost` is a boost by another name and is shown with the boosts, and a `mention` — somebody's page linking here without answering — is neither an answer nor a reaction and gets `conversation.mentions` of its own.

The fediverse half of the conversation is derived from the log at read time, exactly as the comments feeds are: nothing a remote server sent is stored anywhere but the log. Reading it is a walk outwards from the post's object id, because a reply names the post, a reply to that reply names the reply, and a `Delete` or an `Undo` names the activity it takes back — `listActivitiesAbout` answers each round, over `object_id` and the `in_reply_to` index. What the walk finds is then read by the rules a reader would expect:

- A reply whose author deleted it is gone, and the answers to it move up to whatever it was answering rather than disappearing with it. A `Delete` or an `Undo` counts only from the actor that did the thing in the first place — the rule already applied to `Undo(Follow)` — so a signed stranger cannot delete somebody else's comment off the page.
- A like or a boost is counted once per actor however often it was delivered, and disappears when that actor undoes it. A reaction to a *reply* belongs to that reply's own conversation, not to the post's.
- A note answering something the post has nothing to do with is left out, even though the log holds it.

Remote HTML is sanitised by `sanitizeCommentHtml`, the same allowlist the comments feeds republish through, so the page and the feed cannot disagree about what a stranger's markup is allowed to be.

The feeds are the same reading, which is the reason the reader exists. `/comments/feed/` is `latest(limit)`; a post's own comments feed is `spokenIn(thread(document))` — the thread flattened to everything somebody actually said, at every depth, the likes and the boosts left out because a feed item with no words is nothing to publish; and the `source:comments` count on a post feed is `counts(documents)`. `feedComments` is the one place an entry becomes a feed item, so the two feeds cannot disagree about a comment's `guid` or its `link`. Nothing outside this module and the comment intake (doc-6) reads the `ap_inbox` or `comments` index to show a reader a conversation. The moderation screen and the notices do read them, and are not conversation display: they are about what a moderator still has to decide, which is the one thing a reader never sees.

An Eleventy build of the same content shows the same conversation, because it is all in the files: `docs/eleventy.config.example.js` adds a `conversation` filter over `federation.inbox` and puts the post's object id on the context as `activityStreams`, and `test/eleventy.test.ts` builds the fixtures and checks the reply, the like count and the sanitising against what the CMS renders.

## Collections

- Outbox: pages over one user's non-draft posts, newest first, as `Create` activities. It is the author archive as activities, so a post attributed to nobody is on nobody's.
- Followers: from the `followers` index, which is rebuilt from every `content/_data/federation/{username}/followers.json` on every boot.
- Following is always empty: the relays the site follows are a subscription rather than a relationship anybody reads that collection to learn about.
- Featured, liked: not provided.

## Discovery

- WebFinger for every username, served by the CMS (above).
- NodeInfo 2.1 with software name `geekity-cms`, reporting how many users the site has.
- The HTML page for a post links to its ActivityStreams id via `<link rel="alternate" type="application/activity+json">`.

## Storage

Fedify needs a KV store and a message queue. Phase one uses `MemoryKvStore` and `InProcessMessageQueue` (see decision-5). Followers, keys, and the inbox log are ours and live in files (decision-9): `content/_data/federation/{username}/followers.json` holds one object per follower — actor id, inbox, shared inbox, handle, name, icon, profile URL and follow time — oldest follow first, and `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` holds the inbound activities. Both are published with the site and reach an Eleventy build as `federation.{username}.followers` and `federation.inbox` (the monthly logs need a one-line `addDataExtension('jsonl', …)`, which the example config ships); the key pairs are JWK files under `data/keys/`. Every write takes a lock on the file it changes and updates the index before it lets go, so the two cannot disagree, and the whole file is replaced by rename so a reader never sees half of one. SQLite indexes the followers and the inbox log for paging and caches the delivery outcomes — the outcomes only, since no activity is kept — and both indexes are emptied and rebuilt from the files on every boot — `rebuildFederationIndexes({ admin, contentDir })` is the function, and `geekity rebuild` calls the same one. The followers index is keyed by (user, actor), because one actor may follow two of a site's people and that is two follows. The rebuild reads whatever user directories are on disk rather than asking `users.json`, so a rebuilt database puts back exactly what the files say. A file that will not parse stops the boot, naming it: Fedify swallows what a dispatcher throws, so a bad file noticed at request time would be noticed by nobody.

Resend means "send the current state of the post": `cms.delivery.resend(slug)` reads the post from the index and builds the activity from the file at that moment, so a follower whose server was down ends up with the post as it is now rather than with the revision that failed to reach it. Which activity that is follows the delivery table above, applied to the state the file is in:

| The post now | What a resend sends |
| --- | --- |
| published, with no `activitypub.published` | `Create(Article)`, stamping the announcement into the file |
| published, with one | `Update(Article)` under a fresh, timestamped activity id |
| a draft, in the trash, or dated into the future | `Delete` of a `Tombstone` for its object id |

The `Update`'s id carries the moment rather than the content hash a save uses, because a resend is asking for a revision the followers have already been offered to be offered again, and an activity id a peer has seen is one it is entitled to drop.

The federation screen shows one panel per user — their handle, profile, actor id and followers — and one row per post carrying an `activitypub.published`, the trash included, with the user who announced it, read from the content index and joined to the newest cached outcome for that object. The posts come from the files and the outcomes from the cache, in that order: a site that has just deleted its database sees every federated post listed with nothing recorded against it, and can press Resend on any of them.

The one capability given up is tombstoning a post whose file is gone entirely rather than in the trash: there is no file left to build the `Tombstone` from, and no permalink left to name in it.

## Testing

- Unit: object mapping from a fixture post; the actor document from a user profile.
- Integration: `fedify lookup` and `fedify inbox` from `@fedify/cli` against a dev server, scripted in `pnpm fed:smoke`, which also reads WebFinger and asserts on the per-user followers file.
