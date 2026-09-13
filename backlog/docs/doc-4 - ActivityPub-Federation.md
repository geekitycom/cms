---
id: doc-4
title: ActivityPub Federation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-13 01:29'
---
# ActivityPub Federation

Federation is implemented with Fedify (`@fedify/fedify` 2.x) mounted into Hono through `@fedify/hono`. The site is one actor; every published post is an `Article` the actor creates.

## Actor

- Handle: `@{settings.actorHandle}@{host}`, default handle `blog`.
- Type: `Person` by default with a setting to switch to `Service`. Some clients hide `Service` actors from timelines; `Person` is the safer default for a personal blog.
- Profile fields come from settings: name = site title, summary = tagline, url = base URL, icon = uploaded avatar.
- Key pairs (RSA-PKCS#1-v1.5 and Ed25519) are generated on first boot and stored as JWK files under `data/keys/`, one per algorithm, named after the actor's identifier rather than its handle (`actor.rsassa-pkcs1-v1_5.jwk`, `actor.ed25519.jwk`) and written `0600` in a `0700` directory. Each file holds the private key alone; the public half is derived from it. Fedify's `setKeyPairsDispatcher` reads them. A file that will not import stops the boot rather than being replaced: regenerating would change the actor's identity and every follower's cached public key would stop verifying, and Fedify answers a throwing key pairs dispatcher with an actor document that has no `publicKey` at all, which peers would cache.

## Objects

Each non-draft post maps to an `Article`:

- `id`: the post permalink, absolute on `baseUrl` (decision-13). One URL for both audiences: a browser asking for HTML gets the page and a peer asking for ActivityStreams gets this object, served by the permalink middleware rather than by a host-rooted dispatcher, so a site in a subdirectory keeps that directory in its ids. There is no `/ap/posts/{slug}` route.
- `url`: the same permalink
- `name`: title
- `content`: rendered HTML
- `source`: `{ content: markdown, mediaType: "text/markdown" }`
- `published`, `updated`
- `attributedTo`: the actor
- `to`: `Public`, `cc`: followers collection
- `tag`: one `Hashtag` per tag

Pages are not federated.

A post whose front matter already names an `activitypub.id` keeps it as its object id for the life of the post, and the CMS never mints one. That is what lets a post migrated from WordPress keep the `https://example.com/?p=813` its followers, its replies and its RSS subscribers already hold (decision-14): the CMS serves the `Article` at that URL on an ActivityStreams request, redirects a browser from it to the permalink, and names it in every `Update` and `Delete`. The match is on the whole URL, so a stored id with a query string works exactly as one with a path.

Because the id is the permalink, the permalink is a promise to two audiences at once, and the editor keeps it: renaming a published post's slug, or editing its permalink, is refused. A draft's may still change.

## Delivery

| Event | Activity |
| --- | --- |
| post becomes non-draft (new file, or `draft` flips to false) | `Create(Article)` |
| non-draft post content or title changes | `Update(Article)` |
| post becomes draft, is trashed, or file deleted | `Delete(Article)` with a `Tombstone` |

The sync layer emits these events from index diffs, so editing a file on disk federates the same way an admin save does. Deliveries go through Fedify's outbox queue to every follower's inbox (shared inbox when available) and to every accepted relay's inbox. The `activitypub.published` front-matter key records that a post has been announced and when, which is what decides `Create` against `Update` and what a restore reuses. It is the only key a delivery writes.

No activity is stored (decision-9). What SQLite keeps about anything the site has sent is one outcome row per recipient — the activity's id, type, object id and slug, the follower or relay, the inbox used, how it went, why not, and when — which is a cache and is allowed to be empty. That is what the federation screen reads to say how a post last landed.

## Relays

A Mastodon-style relay (FEP-ae0c) boosts every public activity it is sent on to the instances subscribed to it, which is how a small site reaches people who follow nobody on it. Fedify ships the relay *server* half only, so the client half is ours.

- The relay list is a setting, `relays`, one inbox URL per line, in `site.json` like every other setting (decision-9). `https://tags.pub/user/_____relay_____/inbox` is the one this site uses.
- Adding a relay sends a `Follow` whose `object` is the literal Public collection (`https://www.w3.org/ns/activitystreams#Public`) to that inbox, signed the way any other activity is. Fedify attaches the Linked Data signature a Mastodon-style relay verifies.
- The relay answers `Accept` or `Reject`, possibly days later: a subscription may need a human to approve it. The answer is matched to the subscription by the follow id, then by the relay's actor id, then by a single pending subscription on the answering actor's origin.
- Removing a relay sends `Undo` of that `Follow` and drops the record.
- Only an accepted relay is delivered to, and its outcome is recorded in the delivery log against its actor id and its inbox, exactly as a follower's is. Resend therefore reaches relays for free.
- The subscription records live in `ap_relays` in SQLite, keyed by inbox. They are operational state derivable from the file: a relay the settings name that has no record is followed again on the next boot.
- Announces the relay sends back arrive in the inbox log like any other boost.

## Inbox

Handled in phase one:

- `Follow`: store follower, reply `Accept`.
- `Undo(Follow)`: remove follower.
- `Delete` of an actor: remove follower.
- `Accept` and `Reject`: the answer to a relay subscription, which is the only thing this site follows.

Logged but not acted on: `Like`, `Announce`, `Create(Note)` replies. Every handled activity, the follow traffic included, is appended to `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` — one compact JSON-LD activity per line, prefixed with the `receivedAt` the log stamped it with, which is the one thing the activity cannot say for itself. The whole activity is kept so a later phase can surface likes, boosts, and comments without knowing in advance what it will want. The `ap_inbox` table is an index of that file, rebuilt from it on every boot: its columns — the activity id, type, actor, object, arrival time and the `in_reply_to` a `Create` named — are all derived from the line by one function that the live append and the rebuild both call, so a rebuilt row cannot say something the live one did not. That `in_reply_to` index is what the conversation reader below — and through it the comments feeds (doc-3) — reads.

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

- Outbox: pages over non-draft posts, newest first, as `Create` activities.
- Followers and following: from the `followers` index, which is rebuilt from `content/_data/federation/followers.json` on every boot. Following is always empty: the relays the site follows are a subscription rather than a relationship anybody reads that collection to learn about.
- Featured, liked: not provided.

## Discovery

- WebFinger for the actor handle, provided by Fedify.
- NodeInfo 2.1 with software name `geekity-cms`.
- The HTML page for a post links to its ActivityStreams id via `<link rel="alternate" type="application/activity+json">`.

## Storage

Fedify needs a KV store and a message queue. Phase one uses `MemoryKvStore` and `InProcessMessageQueue` (see decision-5). Followers, keys, and the inbox log are ours and live in files (decision-9): `content/_data/federation/followers.json` holds one object per follower — actor id, inbox, shared inbox, handle, name, icon, profile URL and follow time — oldest follow first, and `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` holds the inbound activities. Both are published with the site and reach an Eleventy build as `federation.followers` and `federation.inbox` (the monthly logs need a one-line `addDataExtension('jsonl', …)`, which the example config ships); the key pairs are JWK files under `data/keys/`. Every write takes a lock on the file it changes and updates the index before it lets go, so the two cannot disagree, and the whole file is replaced by rename so a reader never sees half of one. SQLite indexes the followers and the inbox log for paging and caches the delivery outcomes — the outcomes only, since no activity is kept — and both indexes are emptied and rebuilt from the files on every boot — `rebuildFederationIndexes({ admin, contentDir })` is the function, and `geekity rebuild` will call the same one. A file that will not parse stops the boot, naming it: Fedify swallows what a dispatcher throws, so a bad file noticed at request time would be noticed by nobody.

Resend means "send the current state of the post": `cms.delivery.resend(slug)` reads the post from the index and builds the activity from the file at that moment, so a follower whose server was down ends up with the post as it is now rather than with the revision that failed to reach it. Which activity that is follows the delivery table above, applied to the state the file is in:

| The post now | What a resend sends |
| --- | --- |
| published, with no `activitypub.published` | `Create(Article)`, stamping the announcement into the file |
| published, with one | `Update(Article)` under a fresh, timestamped activity id |
| a draft, in the trash, or dated into the future | `Delete` of a `Tombstone` for its object id |

The `Update`'s id carries the moment rather than the content hash a save uses, because a resend is asking for a revision the followers have already been offered to be offered again, and an activity id a peer has seen is one it is entitled to drop.

The federation screen lists one row per post carrying an `activitypub.published`, the trash included, read from the content index and joined to the newest cached outcome for that object. The posts come from the files and the outcomes from the cache, in that order: a site that has just deleted its database sees every federated post listed with nothing recorded against it, and can press Resend on any of them.

The one capability given up is tombstoning a post whose file is gone entirely rather than in the trash: there is no file left to build the `Tombstone` from, and no permalink left to name in it.

## Testing

- Unit: object mapping from a fixture post.
- Integration: `fedify lookup` and `fedify inbox` from `@fedify/cli` against a dev server, scripted in `npm run fed:smoke`.
