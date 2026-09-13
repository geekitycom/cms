---
id: TASK-65
title: >-
  Posts federate under their permalink: the ActivityStreams id is the permalink,
  and a published permalink cannot change
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-05 13:15'
updated_date: '2026-09-13 01:36'
labels:
  - federation
  - web
  - admin
  - content
milestone: m-10
dependencies: []
references:
  - >-
    backlog/decisions/decision-13 -
    A-posts-ActivityStreams-id-is-its-permalink.md
  - packages/cms/src/federation/paths.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/web/documents.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/docs/eleventy.config.example.js
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: enhancement
ordinal: 96500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-4 gave a post two URLs: the permalink for readers and {baseUrl}/ap/posts/{slug} as the ActivityStreams object id, served by a Fedify object dispatcher and frozen into the front matter as activitypub.id at first announce so a renamed post kept its id. decision-13 reverses that. A permalink is by name permanent, the fediverse id is the same promise to a different audience, and one URL can answer both by content negotiation, which the permalink already does for an ActivityStreams request. Make the permalink the object id, absolute on the base URL. Remove the /ap/posts/{slug} object route; the permalink middleware serves the Article and its id is the permalink itself. Never mint activitypub.id; the record that a post was announced and when stays as activitypub.published, which is what delivery reads to choose Create over Update and what resend needs. A stored id is honoured, not dropped: a post whose file already names an activitypub.id keeps it as its object id, the CMS serves the object at that URL on an ActivityStreams request and redirects a browser from it to the permalink, and every Update and Delete names it. That is what lets a post migrated from WordPress keep the ?p=813 id its followers, replies and RSS subscribers hold (decision-14); the matching is on the whole URL, so a stored id with a query string works the same as one with a path. Keep the promise in the editor: renaming a published post's slug or editing its permalink is refused with a message that says why, while a draft's may still change. Replies thread by the object id, so the conversation walk, the comments feeds and the source:comments counts key on it. The Eleventy example config and its fixtures derive activityStreams the same way: the stored id when there is one, else the permalink. This is a feat(cms)! change: a post the demo announced under the old id and has no stored id for is a new object to its followers, and the changelog says so. Nothing is public yet, so it lands before launch and before TASK-63, which derives the feed item's identity from this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A GET of a published post's permalink with an ActivityStreams Accept header returns the Article whose id is that permalink, and the same URL without it returns the HTML page; /ap/posts/{slug} is no longer registered
- [x] #2 Create, Update and Delete activities name the post's object id, delivery still chooses Create for a post never announced and Update afterwards using activitypub.published alone, and the federation screen's resend behaves as before
- [x] #3 The CMS never writes activitypub.id; a file that already carries one keeps it through every save, that URL returns the Article on an ActivityStreams request and a 301 to the permalink otherwise, and activities name it; a stored id with a query string (?p=813) is served the same as one with a path
- [x] #4 The editor refuses to change a published post's slug or permalink with a message saying a published permalink is permanent, and still lets a draft's change; a test covers both
- [x] #5 A fediverse reply whose inReplyTo is the post's object id, permalink or stored, appears in the post's conversation, its comments feed and its source:comments count
- [x] #6 The Eleventy example config puts the object id on the context as activityStreams and the Eleventy test passes; the fed-smoke script fetches the object at the permalink
- [ ] #7 doc-2 (front matter table), doc-3 (negotiation table), doc-4 (object id) and the package README describe one URL per post and the stored-id rule; the commit is feat(cms)! with a BREAKING CHANGE footer naming what followers see
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the object-id rule at its source: a new `postObjectId(document, baseUrl)` in web/documents.ts answers the stored `activitypub.id` when the file names a URL, else the absolute permalink. `activityStreamsId` delegates to it. Delete `POST_OBJECT_PATH`, `postObjectPath` and the slug-based `postObjectId` from federation/paths.ts, and `articleObjectId`/`federatedObject` follow.
2. Drop the Fedify object dispatcher (`setObjectDispatcher(Article, POST_OBJECT_PATH, …)`) and `federatedObject`; the permalink middleware in federation/mount.ts is the only thing that serves an Article.
3. Teach federation/mount.ts the stored id: an ActivityStreams GET of a URL a post's `activitypub.id` names returns that post's Article, and any other GET of it is a 301 to the permalink. Matching is on the whole URL, query string included, built on `baseUrl`.
4. Stop minting an id: delivery's `stamp` writes only `activitypub.published`; `resend` and the store's federated clause key on `published` instead of `id`; the federation screen looks the last delivery up by the post's object id rather than by `activitypub.id`.
5. Editor: refuse to change a published post's slug or its permalink, with a message saying a published permalink is permanent; a draft's still changes.
6. Conversation: resolve an object id back to a post by permalink (and by stored id), so replies, the comments feeds and the `source:comments` counts key on the new id.
7. Eleventy example config: `activityStreams` is the stored id else the permalink; fed-smoke fetches the object at the permalink.
8. Docs: doc-2 front-matter table, doc-3 negotiation table, doc-4 object id, package README, theme README.
9. Verify with pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. The object-id rule now lives in one function, `postObjectId(document, baseUrl)` in `web/documents.ts`: the stored `activitypub.id` when the file names a URL, else the permalink absolute on the base URL. `activityStreamsId` gates it on 'published post' and delegates, so the page's rel=alternate, every feed's key (decision-12), the conversation and the Article all read one rule.

Removed: `POST_OBJECT_PATH`, `postObjectPath`, the slug-based `postObjectId`, `federatedObject` and the Fedify `setObjectDispatcher(Article, …)`. `federation/mount.ts` is now the only thing that serves a post object.

The stored id is served by the same middleware. `ContentStore.getByStoredObjectId` looks a post up by `json_extract(activitypub,'$.id')`; the candidate URL is built as `absoluteUrl(requestPath) + search` on the base URL, so a `?p=813` id matches on the whole URL. An ActivityStreams request there gets the Article, anything else a 301 to the permalink; a stored id equal to the permalink is skipped so it cannot redirect to itself.

Delivery no longer mints an id: `stamp` writes only `activitypub.published` and spreads any existing block, so a migrated post's id survives. `resend` and `ContentStore.listFederated` (FEDERATED_CLAUSE) now key on `published`; the federation screen looks the last delivery up by `postObjectId` instead of the raw `activitypub.id`.

Editor: `promisedDocument` is the seam — a published post (type post, not draft/trashed/scheduled). Its slug may not change, and a submitted permalink naming another URL is refused; the resolved permalink is then pinned to the promised one, so correcting a published post's date refiles the file without moving the URL (decision-13 says the date keeps the day it was filed under). An empty permalink field is read as 'no permalink submitted' rather than as a request to move.

Conversation: `slugOfObjectId` became `permalinkOfObjectId` — strip the base URL's directory, reject a query string, look the permalink up; a stored id falls through to the existing one-pass walk of the archive.

Verification, all from the repo root:
- `pnpm build` — passed.
- `pnpm test` — passed: 1429 CMS tests, 14 demo tests, 0 failures.
- `pnpm test:11ty` — passed: 15 + 5, 0 failures.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm format:check` — passed (after `pnpm format`).
- `pnpm fed:smoke` — passed end to end against `@fedify/cli` and a Fedify peer: `fedify lookup http://localhost:PORT/2026/03/already-published/` returned the Article, and the peer accepted Create(Article) and Update(Article) of `http://localhost:PORT/2026/03/hot-off-the-press/`.

Evidence per criterion:
#1 federation/article.test.ts 'answers with an Article whose id is the permalink (decision-13)' and 'no longer answers at the old /ap/posts/{slug} object URL'; 'leaves the HTML, Markdown and JSON representations alone'.
#2 federation/delivery.test.ts (Create on publish, Update on edit, Delete of a Tombstone, restore reusing the id, the delivery log) and federation/relays.test.ts resend cases; the Create/Update choice now reads `activitypub.published` alone.
#3 delivery.test.ts 'writes the first-published time, and no id, into the post's front matter' asserts no `id:` is written; admin/posts.test.ts 'keeps the activitypub.id its file names through a save'; article.test.ts 'a post whose file already names an activitypub.id' covers `?p=813` and a path-shaped id, Article on ActivityStreams and 301 otherwise, and that `/` and `/?p=999` are untouched; rebuild.test.ts fetches the object at both the stored id and the permalink.
#4 admin/posts.test.ts 'refuses to change a published post's slug', 'refuses to change a published post's permalink, and says why', 'still renames a draft', 'still moves a draft's permalink where the author puts it'.
#5 web/feeds.test.ts 'a reply to a migrated post's stored object id' — the post's comments feed, the site-wide one, the source:comments count and the conversation on the page; web/conversation.test.ts and web/site.test.ts cover the permalink id.
#6 packages/cms/docs/eleventy.config.example.js derives activityStreams from the stored id else the permalink (new `absoluteUrl` helper replaces `originOf`); test/eleventy.test.ts passes, and reverting the fixture's inbox id makes it fail, so the linkage is live. fed-smoke fetches the object at the permalink.
#7 doc-2, doc-3 (new 'A stored object id' section), doc-4, packages/cms/README.md, the root README and themes/default/README.md updated. The commit half is outside an agent's remit here.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-09-13 01:36
---
AC #7's documentation half is done and verified by reading the files back: doc-2's front-matter table, doc-3's representation table plus a new 'A stored object id' section, doc-4's object and delivery sections, packages/cms/README.md, the root README and themes/default/README.md. The commit half is the only thing left, and agents in this repo do not commit. Suggested message:

feat(cms)!: federate posts under their permalink

BREAKING CHANGE: a post's ActivityStreams id is now its permalink, and the
/ap/posts/{slug} route is gone. A post announced under the old id, and with no
activitypub.id in its file, is a new object to its followers; its RSS guid moves
with it. A post whose file names an activitypub.id keeps it. The CMS no longer
writes activitypub.id, and the editor refuses to change a published post's slug
or permalink.

Check AC #7 and set the task to Done once that commit lands.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's ActivityStreams object id is now its permalink (decision-13), served by content negotiation at that one URL; /ap/posts/{slug} and the Fedify object dispatcher are gone. The rule lives in postObjectId() in web/documents.ts and every reader — the Article, the page's rel=alternate, the three feeds, the conversation, delivery and the federation screen — goes through it. The CMS never writes activitypub.id; a stored one is honoured for the life of the post, served at its own URL (query string included) for a peer and 301'd to the permalink for a browser, and delivery now records only activitypub.published. The editor refuses to change a published post's slug or permalink and leaves a draft's free. Verified with pnpm build, test (1429 + 14), test:11ty (15 + 5), typecheck, lint and format:check all passing, and pnpm fed:smoke passing end to end against @fedify/cli and a Fedify peer. AC #7's documentation half is complete; its commit half is left to the caller (see the task comment for the exact feat(cms)! message).
<!-- SECTION:FINAL_SUMMARY:END -->
