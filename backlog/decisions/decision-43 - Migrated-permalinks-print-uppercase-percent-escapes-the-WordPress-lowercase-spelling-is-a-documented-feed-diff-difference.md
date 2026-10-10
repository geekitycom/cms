---
id: decision-43
title: >-
  Migrated permalinks print uppercase percent-escapes; the WordPress lowercase
  spelling is a documented feed-diff difference
date: '2026-10-10 10:36'
status: accepted
---
## Context

TASK-314. WordPress post 753 on andrewshell.org has the slug `i-♥-rss`, and
WordPress prints its permalink with lowercase escapes,
`/2026/07/i-%e2%99%a5-rss/`, in every feed. The importer writes the permalink
decoded, and core prints it with uppercase escapes, `%E2%99%A5`. RFC 3986 calls
the two equivalent, and the post's feed guid (`?p=753`) is kept, so no reader
sees the post as new. The migration plan wants feed link sets byte-identical
to WordPress.

Core keeps `permalink` decoded as a lookup key. About 107 uses across 36 core
files read it that way: the store index, `getByFormerPermalink`,
permalink-keyed `_data` files, comment data file names, and redirects.
`routes.ts` compares the decoded request path with the permalink and answers a
301 to `encodePath(permalink)`.

## Decision

Uppercase escapes are canonical, for migrated posts as for every other post.
The plugin-wordpress README names the difference, so a migrating site expects
it in a feed diff. Both spellings of the URL answer 200.

Keeping WordPress's spelling had two routes, and neither is one point in the
data flow. Storing the permalink encoded breaks the decoded key, and makes
`routes.ts` redirect a request to itself. Carrying a second as-spelled field
means threading it through the same 36 files.

## Consequences

- A feed, sitemap or ActivityPub diff against WordPress shows the escape case
  of a non-ASCII slug as a difference. The guid matches, so subscribers see
  nothing new.
- A test in `packages/plugin-wordpress/test/comments-import.test.ts` pins the
  uppercase form on every surface and the 200 for both spellings.
- Revisiting this means making the permalink an encoded key throughout core,
  not a migration-only special case.
