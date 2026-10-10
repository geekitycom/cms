---
id: decision-51
title: >-
  Every comment and repliable item has one 16-hex key; stored comment ids are
  keys
date: '2026-10-10 22:59'
status: accepted
---
## Context

A comment's stored id went verbatim into every URL about it. Ids came in three
shapes: a UUID (form comment, webmention), an ActivityPub URL (fediverse
reply), and a full WordPress URL for an imported comment
(`https://andrewshell.org/?p=574#comment-32`). Core treated a URL-shaped id as
the comment's legacy feed guid, so the id did two jobs, and every anchor,
`/comment/` page and `/replies/` link inherited a URL, percent-encoded or raw.
decision-48 made `/replies/{segment}/` read a 16-hex segment as a key and
anything else as a native comment id.

## Decision

- Every comment, and every item that can be replied to, has one key of 16
  lowercase hex digits. It is the only thing in `/comment/{key}/`,
  `/replies/{key}/` and `#comment-{key}`, for every source. Old WordPress
  `#comment-N` anchors are not kept.
- A stored comment's id is its key.
  - A new form comment's key is 16 random hex digits minted at submission, and
    its page `/comment/{key}/` is its guid.
  - A native webmention's key is the first 16 hex digits of SHA-256 of
    `{source} {post permalink}`, because its identity is its source and target
    (doc-7). Its guid is its source URL.
  - A post, page, fediverse reply or reaction, or reply post has key = the
    first 16 hex digits of SHA-256 of its guid.
- Core refuses to store a comment whose id is not a key, naming the file and
  the id.
- A comment imported from another system is marked `migrated: true`. It keeps
  its origin identity, and its key is the hash of that origin: a fediverse
  note or activity id, or a webmention's source. A comment with no origin
  elsewhere (a WordPress form comment) is keyed by the hash of its old comment
  URL. A re-import gives the same keys. A migrated comment shows on its page
  and in its thread, and is in no feed and no advertised reply count. So no
  legacy guid is kept, and no id does two jobs.
- Ids stored before keys (UUID form comments and webmentions since v0.29.0,
  and URL ids from plugin-wordpress 0.2.0) are re-keyed in place at boot to the
  first 16 hex digits of SHA-256 of the old id. A comment's `inReplyTo`, its
  email under `data/`, and any document naming the old page or anchor follow.
  There are no redirects, because no deployed site holds such comments.
- This supersedes decision-48's rule that a `/replies/` segment is either a key
  or a native comment id. Every segment is a key.

## Consequences

- One key shape everywhere. Anchors, comment pages, `/replies/` feeds,
  `?reply_to=` and `source:comments` links carry no percent-encoded URL.
- A form comment's page, and so its comments-feed guid, changes once when it
  is re-keyed. A webmention's comments-feed guid becomes its source URL.
- The admin store indexes no separate comment key, since the key is the id.
  Its `replies_key` and `keys_base` columns and its `baseUrl` option are gone.
- A remote fediverse note that answered an old `/comment/{uuid}/` page is not
  rewritten, and threads under the post instead.
- `writePost` is the one place a non-key id is refused, so every writer is
  covered.
