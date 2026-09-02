---
id: doc-4
title: ActivityPub Federation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-02 13:23'
---
# ActivityPub Federation

Federation is implemented with Fedify (`@fedify/fedify` 2.x) mounted into Hono through `@fedify/hono`. The site is one actor; every published post is an `Article` the actor creates.

## Actor

- Handle: `@{settings.actorHandle}@{host}`, default handle `blog`.
- Type: `Person` by default with a setting to switch to `Service`. Some clients hide `Service` actors from timelines; `Person` is the safer default for a personal blog.
- Profile fields come from settings: name = site title, summary = tagline, url = base URL, icon = uploaded avatar.
- Key pairs (RSA-PKCS#1-v1.5 and Ed25519) are generated on first boot and stored in SQLite. Fedify's `setKeyPairsDispatcher` reads them.

## Objects

Each non-draft post maps to an `Article`:

- `id`: `{baseUrl}/ap/posts/{slug}` (stable, independent of permalink changes)
- `url`: the post permalink
- `name`: title
- `content`: rendered HTML
- `source`: `{ content: markdown, mediaType: "text/markdown" }`
- `published`, `updated`
- `attributedTo`: the actor
- `to`: `Public`, `cc`: followers collection
- `tag`: one `Hashtag` per tag

Pages are not federated.

## Delivery

| Event | Activity |
| --- | --- |
| post becomes non-draft (new file, or `draft` flips to false) | `Create(Article)` |
| non-draft post content or title changes | `Update(Article)` |
| post becomes draft, is trashed, or file deleted | `Delete(Article)` with a `Tombstone` |

The sync layer emits these events from index diffs, so editing a file on disk federates the same way an admin save does. Deliveries go through Fedify's outbox queue to every follower's inbox (shared inbox when available). The `activitypub.id` front-matter key records that a post has been announced so a rename or restore does not create a duplicate object.

## Inbox

Handled in phase one:

- `Follow`: store follower, reply `Accept`.
- `Undo(Follow)`: remove follower.
- `Delete` of an actor: remove follower.

Logged but not acted on: `Like`, `Announce`, `Create(Note)` replies. These are stored in an `ap_inbox` table so a later phase can surface likes, boosts, and comments.

## Collections

- Outbox: pages over non-draft posts, newest first, as `Create` activities.
- Followers and following: from SQLite. Following is always empty in phase one.
- Featured, liked: not provided.

## Discovery

- WebFinger for the actor handle, provided by Fedify.
- NodeInfo 2.1 with software name `geekity-cms`.
- The HTML page for a post links to its ActivityStreams id via `<link rel="alternate" type="application/activity+json">`.

## Storage

Fedify needs a KV store and a message queue. Phase one uses `MemoryKvStore` and `InProcessMessageQueue` (see decision-5). Followers, keys, and the inbox log are ours and live in SQLite regardless.

## Testing

- Unit: object mapping from a fixture post.
- Integration: `fedify lookup` and `fedify inbox` from `@fedify/cli` against a dev server, scripted in `npm run fed:smoke`.
