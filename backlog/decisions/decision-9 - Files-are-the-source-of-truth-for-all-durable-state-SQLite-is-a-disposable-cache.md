---
id: decision-9
title: >-
  Files are the source of truth for all durable state; SQLite is a disposable
  cache
date: '2026-09-04 00:17'
status: accepted
---
## Context



## Decision



## Consequences

## Context

decision-1 made Markdown files the source of truth for content and left "data with no natural file form" (settings, users, keys, followers, the inbox log, the delivery ledger) authoritative in SQLite. TASK-14 then made SQLite the source for settings with `site.json` as a mirror. On 2026-09-03 the user asked to reverse that: if data is stored on the filesystem it should be the truth, and the database should be something a site can delete at any time and have rebuilt.

Two kinds of state were separated in the discussion. Derived state (the content index, sessions, the delivery ledger, a future search index) can be rebuilt or lost without consequence. Irreducible state (settings, users and password hashes, actor key pairs, followers, the inbox log) cannot be rebuilt from anything but can be stored as files.

## Decision

Every piece of irreducible state lives in a file. `content/` holds what is public and published with the site; `data/` holds what is private and must be backed up. `data/geekity.db` holds only derived state and may be deleted at rest; the next boot rebuilds it from the files. A `geekity rebuild` command does the same on demand.

- `content/_data/site.json` is the source of truth for settings. The settings table goes away.
- `content/_data/federation/followers.json` holds the followers. `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` holds inbound likes, boosts and replies, one activity per line. Both are exposed to Eleventy as data.
- `data/keys/` holds the actor key pairs as JWK files with 0600 permissions.
- `data/users.json` holds usernames and Argon2 hashes.
- Sessions, the content index, the followers and inbox indexes, and the delivery outcomes stay in SQLite as caches.
- "Redeliver" becomes "resend the current state of this post": the activity is rebuilt from the file at click time (`Create` when never announced, `Update` with a fresh id when published, `Delete` with a `Tombstone` when drafted or trashed). Stored activity payloads go away.

Every file write is atomic (write to a temporary name, then rename), and the process serialises writers to one file in memory, since SQLite's transactions no longer cover them.

## Consequences

- Backup is two directories: `content/` in git and `data/` copied. Nothing a site cannot afford to lose is in the database.
- Followers' display names and avatar URLs enter the site's git history. The fediverse treats them as public; git makes them permanent.
- Boot scans the followers file and the inbox log to build their indexes. Trivial at blog scale; the design does not target thousands of followers.
- Two writers can touch `site.json` and `followers.json`: the admin and a person with an editor. The file wins, as it does for posts; the admin re-reads before writing.
- Existing sites migrate on boot: rows found in the old tables are written out as files once, then the tables are dropped. Losing the actor keys would break federation for every follower, so that migration is the one that must be proved before release.
- The only capability given up is tombstoning a post whose file is gone entirely rather than in the trash. Trashed posts keep `activitypub.id`, so they can still be deleted from followers' timelines.
