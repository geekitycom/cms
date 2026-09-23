---
id: TASK-32
title: >-
  Followers and the inbox log live in content/_data/federation; SQLite indexes
  them
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 17:18'
labels:
  - federation
milestone: m-4
dependencies:
  - TASK-18
  - TASK-20
  - TASK-29
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: task
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The inbox handlers write `content/_data/federation/followers.json` (one object per follower: actor id, inbox, shared inbox, handle, name, icon, url, followed time) and append inbound Like, Announce and Create activities to `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, one compact JSON-LD activity per line. Both are published with the site and reach Eleventy and the theme as data. SQLite keeps `followers` and `ap_inbox` purely as indexes: they are rebuilt from the files on boot, and every file write updates them in the same step. The followers collection, delivery fan-out and the federation screen read the index as they do now. Existing rows migrate to the files once on first boot. Writes to each file are atomic and serialised in process; a Follow and an Undo arriving together cannot tear the file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Follow appends the follower to followers.json and an Undo(Follow) or actor Delete removes it; the file is valid JSON after every step
- [x] #2 Likes, boosts and replies are appended to the month's inbox JSONL file and appear on the federation screen
- [x] #3 Deleting the database and booting rebuilds the followers and inbox indexes so the followers collection, the federation screen and delivery fan-out are identical to before
- [x] #4 Existing followers and ap_inbox rows are written to the files on first boot and a test proves the followers collection is unchanged across that boot
- [x] #5 An Eleventy build of the content directory sees the followers and the inbox entries as data (test in test/eleventy.test.ts or the demo)
- [x] #6 Editing followers.json by hand and restarting is reflected in the collection
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all public: the new src/federation/records.ts, which owns content/_data/federation (a follower is added, listed, replaced and removed through it; an activity is appended to the right month file; a file that will not parse is a named error; the two writers cannot tear either file; rebuildFederationIndexes puts the files into SQLite and migrateFederationToFiles puts an old database's rows into the files); the inbox itself through a real CMS in inbox.test.ts (a Follow writes followers.json and the index in one step, an Undo and an actor Delete take the entry out, a Like, an Announce and a reply reach the month's JSONL and the federation screen); a boot over a database in the old shape, and a boot with the database deleted, both compared against /ap/actor/followers, the federation screen and delivery.deliveryTargets; a hand edit of followers.json across a restart; and the Eleventy build in test/eleventy.test.ts.

2. files/atomic.ts gains withFileLock(file, task): the per-path queue it already keeps, exposed. The index write is not a second step after the file write — it is inside the same lock, so nothing else writing that path can get between them and an add racing a remove cannot leave the index saying something the file does not. updateFileAtomically is re-expressed on top of it, so there is one queue rather than two.

3. src/federation/records.ts is the module that owns content/_data/federation, as keys.ts owns data/keys and accounts.ts owns data/users.json. It carries the paths (followersFile, inboxDir, inboxFile for a month), the readers (readFollowersFile, readInboxLog), the three writers (addFollower, removeFollower, appendInboxActivity), the rebuild and the migration. followers.json is a JSON array of {actorId, inboxId, sharedInboxId, handle, name, iconUrl, url, followedAt}, oldest follow first, pretty-printed with a trailing newline. Each inbox line is the compacted activity with receivedAt as its first key, which is the one thing the JSON-LD cannot say and the federation screen shows.

4. One derivation, not two: a line is turned into an index row by a single inboxRowFromLine, used by the live append and by the rebuild alike, so a rebuilt row cannot differ from the row the activity first made. It derives activityId, activityType, actorId, objectId and inReplyTo from the JSON through replies.ts's uriOf-style reading, and in_reply_to stays derived by replyTargetOf exactly as it is now.

5. rebuildFederationIndexes({admin, contentDir}) truncates followers and ap_inbox and reinserts from the files inside one transaction, and is exported for TASK-34's geekity rebuild to call. A file that will not parse throws an error naming it — Fedify swallows what a dispatcher throws, so this has to be caught at boot rather than at a request. migrateFederationToFiles({admin, contentDir}) writes the files from the rows only when they are absent, since the files did not exist before this version; then createCms calls the rebuild.

6. The handlers stop calling putFollower, deleteFollower and logInboxActivity and call the module instead, through context.data.config.contentDir. The store keeps every one of those methods, because the rebuild is what uses them now.

7. Eleventy: docs/eleventy.config.example.js gains a jsonl data extension, so content/_data/federation/inbox/{yyyy}-{mm}.jsonl reaches a build as federation.inbox['2026-09'] beside federation.followers; the fixtures gain both files and the page layout renders them; eleventy.test.ts asserts a build sees them (AC #5).

8. Docs: doc-4's inbox and followers lines, doc-1 where it lists what is in content/, and the READMEs where they say followers live in SQLite. Then pnpm build, test, typecheck, lint, format:check, test:11ty and fed:smoke from the root, and a manual pass on port 3000 over scratch directories: a Follow and a Like through the smoke peer, read the files, delete geekity.db, boot, compare /ap/actor/followers and the federation screen.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`packages/cms/src/federation/records.ts` is the module that owns `content/_data/federation`, as `keys.ts` owns `data/keys` and `accounts.ts` owns `data/users.json`. It carries the paths (`followersFile`, `inboxDirectory`, `inboxMonth`, `inboxFile`), the readers (`readFollowers`, `readInboxLog`), the three writers (`addFollower`, `removeFollower`, `appendInboxActivity`), the one derivation (`inboxRowFrom`), the rebuild (`rebuildFederationIndexes`) and the migration (`migrateFederationToFiles`).

`followers.json` is a JSON array, oldest follow first, of `{actorId, inboxId, sharedInboxId, handle, name, iconUrl, url, followedAt}`, indented with a trailing newline. Each inbox line is the compacted activity with `receivedAt` in front of it — the one thing the activity cannot say for itself, and what the federation screen orders by.

`inbox.ts` no longer touches the store: `handleFollow` calls `addFollower`, `handleUndo` and `handleDelete` call `removeFollower`, and `logActivity` calls `appendInboxActivity` with the compacted JSON, all through `context.data.config.contentDir`. Its `activityTypeName` helper went with the row it used to build.

`files/atomic.ts` gained `withFileLock(file, task)`: the per-path queue it already kept, exposed, with `updateFileAtomically` re-expressed on top of it. `AdminStore` gained `replaceFollowers` and `replaceInboxActivities` (delete-and-reinsert in one transaction, the `ap_inbox` AUTOINCREMENT sequence reset with it) and `NewInboxActivity` gained an optional `receivedAt`, as `NewFollower` has an optional `followedAt`. `replies.ts` exports `uriOf`. `createCms` runs `migrateFederationToFiles` then `rebuildFederationIndexes` after `migrateUsersToFile`.

`docs/eleventy.config.example.js` gained a `.jsonl` data extension; the test fixtures gained both files and the page layout renders them.

## Decisions

- **The index write is inside the lock on the file, not a step after it.** `withFileLock` holds the read, the atomic write and the index write as one thing, so a follow and an unfollow racing cannot leave the index saying what the file does not. The writers' bodies are wholly synchronous (`readFileIfPresentSync` + `writeFileAtomicallySync`), which is why they cannot interleave even in a single process; the lock is what keeps that true if one ever stops being, and is what serialises them against `updateFileAtomically` on the same path.
- **One derivation, used twice.** `inboxRowFrom(line)` builds the index row, and the live append and the boot rebuild both call it. That is not tidiness: it is the only way to be sure a rebuilt row cannot say something the live row did not, which is what AC #3 asks for. `in_reply_to` stays derived inside the store by `replyTargetOf`, from the same JSON.
- **`receivedAt` is on the line rather than in an envelope.** The alternative — `{receivedAt, activity: {…}}` — would make a theme read `entry.activity.object.content`. As one extra first key the line is still one compact JSON-LD activity, a JSON-LD processor drops the undefined term, and `entry.type` and `entry.actor` are where a template expects them. The index's `json` column is the activity with that key taken off again, so it stays exactly what the peer delivered.
- **The log keeps the follow traffic too.** doc-4 says the log is a complete record of what the inbox was told, and there is a test on it; the file is that record. The federation screen still shows only `INBOX_INTERACTIONS`.
- **No table is dropped.** The other three decision-9 migrations end in `dropLegacyTable`; this one must not, because `followers` and `ap_inbox` are the index the collection, the fan-out and the comments feeds read. The migration is therefore the simple one — the files did not exist before this version, so a file that is there wins outright and rows are written out only where there is none — and the rebuild runs on every boot rather than once.
- **The row ids are a function of the file.** `replaceInboxActivities" resets `sqlite_sequence`, so the same log gives the same ids however often it is rebuilt and on whatever machine. Without it every restart would renumber the log.
- **A damaged file stops the boot, naming it.** Fedify swallows what a dispatcher throws (TASK-30 found this), so a followers file read as "no followers" would silently unfollow everybody and nobody would be told. A follower entry with no `actorId` or no `inboxId` is refused for the same reason: dropping it quietly would leave the file and the index disagreeing.
- **The rebuild reads before it writes**, so a file that will not parse leaves the index exactly as it was rather than emptying it and then failing.
- **A redelivery replaces its line where it stands**, which is what the unique index on `activity_id` does to the row. Only the month it arrives in is searched; a redelivery months later leaves two lines, and the rebuild's own upsert collapses them to the same one row the live path has.
- **The theme was left alone.** Eleventy exposes `federation.followers` and `federation.inbox` by itself because the files are under `_data`; the CMS renderer's globals are `site` and `menu`, and the theme already reaches replies through `postComments` and `commentCounts`. Adding a second, duplicate route to the same data was not in any criterion.
- **`fed:smoke` now registers its ephemeral follower through `addFollower`** rather than `putFollower`, and asserts the files — so the socket-level Follow and a new socket-level Like prove AC #1 and AC #2 against a real peer over a real port.

## Mutation checks

Each mutation failed exactly the tests that name that behaviour:

- `rebuildFederationIndexes` a no-op -> 8 failed: every rebuild test, both migration tests, the delete-and-boot one and the hand-edit one.
- `migrateFederationToFiles` a no-op -> only the two tests about an older database's rows.
- the index write dropped from `addFollower` -> 7 in records.test.ts and 5 in inbox.test.ts, all of them about the collection or the index seeing a follow.
- `receivedAt` left off the line -> 8 failed, including the delete-and-boot comparison, because a rebuild then has no arrival time to put back.
- the `sqlite_sequence` reset removed -> only 'gives the log the same row ids every time' and the migration round trip.
- `withFileLock` made a bare `Promise.resolve().then` -> the three lock tests in atomic.test.ts, including `updateFileAtomically`'s concurrency one.

## Validation

`pnpm build`, `pnpm test` (1004 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:11ty` (11 + 5) and `pnpm fed:smoke` all pass from the repo root.

## Manual pass on port 3000

A scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in) and `apps/demo/server.ts`. `apps/demo/data` was never opened.

- Seeded `content/_data/federation/followers.json` with Ada and `inbox/2026-09.jsonl` with one Like, then booted. `/ap/actor/followers?cursor=0` listed Ada; `sqlite3` showed the `followers` row and one `ap_inbox` row at id 1 with the file's own `received_at`, activity id, type, actor and object.
- Set up the first admin and captured `/admin/federation`: 'Ada Lovelace', '@ada@remote.example' and 'liked'.
- **AC #3.** Killed the server, deleted `geekity.db`, `-wal` and `-shm`, booted again on the same directories, signed in through the login form: the followers collection page was byte-identical, the federation screen was byte-identical once the per-session CSRF token was normalised, and `ap_inbox` was back at id 1 with the same arrival time.
- **AC #6.** Killed the server, added Grace to `followers.json` by hand, booted: the collection was `[grace, ada]` — newest follow first — and `totalItems` was 2.
- Truncated `followers.json` to `[{"actorId": "https://rem`: `npx tsx server.ts` exited 1 with '…/content/_data/federation/followers.json could not be read as JSON: Unterminated string in JSON at position 25', and nothing was listening on 3000. Restoring the file let it boot; `/`, `/feed/`, `/admin/login` and `/ap/actor` (with an ActivityStreams `Accept`) all answered 200.
- No `.tmp` file was left behind anywhere under `content/`. Port 3000 was released and the scratch directories deleted.

## Where AC #1, #2 and #5 were proved

- **AC #1 and #2** in `src/federation/inbox.test.ts` ('the federation files'), where a signed `Follow`, `Undo`, actor `Delete`, `Like`, `Announce` and `Create(Note)` are delivered to the real inbox and the files are read back — and again in `pnpm fed:smoke`, where the `Follow` and the `Like` cross real sockets from a Fedify peer and the run asserts on `followers.json` and the month's JSONL.
- **AC #5** in `packages/cms/test/eleventy.test.ts`: an Eleventy 3 build of the fixtures with the shipped example config renders both followers out of `federation.followers` and both logged activities out of `federation.inbox['2026-09']`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The followers and the inbox log are files the site publishes: `content/_data/federation/followers.json`, one object per follower with its inboxes, profile and follow time, and `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, one compact JSON-LD activity per line with the time it arrived in front of it. The `followers` and `ap_inbox` tables stay, but only as indexes of those files: every boot empties them and reads them back, so deleting the database costs a site nothing and editing `followers.json` by hand and restarting is a supported thing to do.

The new `packages/cms/src/federation/records.ts` owns both files the way `keys.ts` owns `data/keys`. Its three writers take a lock on the file they are about to change — `withFileLock`, the queue `files/atomic.ts` already kept, now exposed — and write the index before letting go, so a follow and an unfollow arriving together cannot leave the index saying what the file does not. One function turns a line into an index row, and the live append and the boot rebuild both call it, which is what makes a rebuilt row provably the row the activity first made; `in_reply_to` stays derived inside the store from the same JSON, so the comments feeds survive the rebuild too. `rebuildFederationIndexes({ admin, contentDir })` is exported for TASK-34's `geekity rebuild` to call, and reads before it writes so a damaged file leaves the index alone. No table is dropped, unlike the three earlier decision-9 migrations: an older database has its rows written out once, only where no file is there, and then read back like any other.

A file that will not parse stops the boot with the file named, because Fedify swallows what a dispatcher throws and a followers file read as 'no followers' would silently unfollow everybody.

Verified with 1004 package tests (0 fail), 40 of them new — the file after a follow, a refresh, an unfollow and a burst; the month a line lands in; the columns derived from it; a redelivery replacing its line; the rebuild's contents, determinism and refusal; the migration and the file winning over the rows; a signed Follow, Undo, actor Delete, Like, Announce and reply through a real inbox; a database deleted and booted with the followers collection, the federation screen and `deliveryTargets` compared exactly; and an Eleventy 3 build of the fixtures reading `federation.followers` and `federation.inbox` through the shipped example config's new `.jsonl` data extension. Each mutation-checked: a no-op rebuild, a no-op migration, the index write dropped, `receivedAt` left off the line, the sequence reset removed and the lock made a bare microtask each failed exactly the tests that name that behaviour. `pnpm fed:smoke` now sends a Follow and a Like over real sockets from a Fedify peer and asserts on the files. Then a manual pass on a real server on port 3000 over scratch directories: seeded files picked up at boot, the database deleted and the collection and screen byte-identical after the reboot, a hand edit reflected on the next start, and a truncated `followers.json` exiting 1 with the file named. `pnpm build`, `test`, `typecheck`, `lint`, `format:check` and `test:11ty` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
