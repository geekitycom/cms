---
id: TASK-39
title: >-
  Comments feeds from ActivityPub replies: per post and site-wide, with
  source:comments
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:51'
updated_date: '2026-09-04 03:19'
labels:
  - web
  - federation
milestone: m-5
dependencies:
  - TASK-37
  - TASK-18
references:
  - 'https://source.scripting.com/'
  - 'https://andrewshell.org/2026/08/meet-me-at-wordcamp/feed/'
  - 'https://andrewshell.org/comments/feed/'
type: feature
ordinal: 27250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site serves a comments feed per post at `{permalink}feed/` and a site-wide one at `/comments/feed/`, and the `source` namespace defines `<source:comments count="N" feedUrl="…"/>` as the item-level pointer to that feed. The CMS has no comments of its own, but the inbox log already stores every `Create` reply a fediverse actor sends (`inReplyTo` is the post's ActivityStreams object id), so those replies are the comments.

Serve `{permalink}feed/` as RSS 2.0 titled "Comments on: {title}" whose items are that post's replies newest first: `title` from the actor's name or handle, `link` and `guid` the reply's `url` or `id`, `dc:creator`, `pubDate` from the reply's `published` or the received time, `description` and `content:encoded` from the Note's content (sanitised HTML), plus `atom:link rel="self"`. `/comments/feed/` is the same over every post, each item also naming its post. Both honour `feedSize` and answer empty rather than 404 for a post with no replies; an unknown permalink is a 404. The trailing-slash canonical redirect covers both.

Every RSS post item then carries `<source:comments count="N" feedUrl="{permalink}feed/"/>` with the reply count, and for WordPress parity `<comments>{permalink}#comments</comments>` and `<wfw:commentRss>` (namespace `http://wellformedweb.org/CommentAPI/`) pointing at the same feed. Counting replies per post needs an indexed `in_reply_to` column on the inbox index rather than a JSON scan; TASK-32 later rebuilds that index from the inbox log files, so keep the column derived from the stored activity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post's {permalink}feed/ is RSS 2.0 titled Comments on: {title} listing that post's replies from the inbox log newest first with the elements in the description, and is empty rather than 404 when there are none
- [x] #2 /comments/feed/ lists replies across every post newest first, each item naming its post
- [x] #3 Every RSS post item carries source:comments with the correct count and the per-post feed URL, plus comments and wfw:commentRss for WordPress readers
- [x] #4 A reply to a post that is later trashed or unpublished stops appearing in /comments/feed/ and its per-post feed answers 404
- [x] #5 Reply HTML is sanitised before it enters a feed
- [x] #6 /comments/feed and {permalink}feed redirect 301 to their slashed forms
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `src/web/sanitize.ts`: `sanitizeCommentHtml(html)` — a tokenising allowlist sanitiser that re-serialises rather than passes through, so nothing in the input can reach the output as markup. Keeps p, br, a, em/i, strong/b, del/s, code, pre, blockquote, ul/ol/li and span (unwrapped); drops script and style with their contents; unwraps every other element; keeps only `href` on `<a>`, only http/https/mailto, and writes `rel="nofollow noopener noreferrer"`. No dependency is added: the package has no sanitiser and the alternatives (sanitize-html, jsdom+DOMPurify) are large for one narrow, well-tested job.
2. `src/federation/replies.ts`: what a stored inbound activity means as a reply. `replyTargetOf(json)` derives the `inReplyTo` id from the compacted activity (`object.inReplyTo`, string or first of an array); `replyFrom(activity, options)` projects a logged `Create` into a `Reply` — the note's id, url, published time, raw content HTML, and a display name from the followers row for that actor, else an `@user@host` derived from the actor URL, else the URL itself.
3. Store: MIGRATIONS gain an optional `run(db)` step; migration 8 adds `ap_inbox.in_reply_to` with an index and backfills existing rows through `replyTargetOf`, the same function `logInboxActivity` now writes with — so the column stays derivable from the stored activity for TASK-32's rebuild. New methods: `countRepliesTo(objectId)`, `listRepliesTo(objectId, page)`, `countReplies()`, `listReplies(page)`.
4. `src/web/comments.ts`: the query side. `postComments(admin, document, baseUrl, limit)`; `siteComments(admin, store, baseUrl, limit)` which over-fetches and keeps only replies whose `inReplyTo` resolves to a public post (fast path: parse `/ap/posts/{slug}` and check `activityStreamsId` agrees; fallback: one lazy scan for a renamed post); `commentCounts(admin, documents, baseUrl)` for the `source:comments` counts.
5. `src/web/feeds.ts`: declare the `wfw` namespace; every RSS item gains `<comments>`, `<wfw:commentRss>` and `<source:comments count feedUrl>` when the source carries `commentCounts`, which also join the fingerprint so a new reply changes the ETag. New `commentsRssFeed(source)` and `commentsFeedResponse`, sanitising each comment's HTML at the point it is written. `feedExcerpt`'s tag-stripping becomes `excerptFromHtml`, shared with the comment `description`.
6. `src/web/routes.ts`: `parseFeedPath` returns a target union — a listing, the site-wide comments feed at `/comments/`, or one post's at its permalink — so `resolveRequest`, `canonicalTarget` and `feedHref` all cover the new roots and the 301s fall out. `/comments/feed/` is a real route beside the other three; a post's is resolved through `publicDocumentAt`. Comments feeds are RSS only. `?feed=rss2|rss` on a post permalink 301s to its comments feed, as WordPress served it. `comments` joins `RESERVED_TOP_LEVEL_PATHS`.
7. Theme: `partials/feeds.njk` gains a `commentsFeedLink` macro; `base.njk` advertises `/comments/feed/` and, when the renderer sets `commentsFeed`, the post's own — set in `renderDocument` beside `activityStreams`, so a site that overrides `post.njk` (as the demo does) keeps it.
8. Docs: doc-3's feeds table and prose, the route table and Feeds section of packages/cms/README.md, and the theme README.
9. Red-green throughout in `src/web/feeds.test.ts` (using the file's own strict XML reader), a new `src/web/sanitize.test.ts`, and `src/admin/store.test.ts` for the column, the backfill and the new queries; `src/federation/inbox.test.ts` proves a signed Create lands with its `in_reply_to` set.
10. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check from the root, then the running demo over curl with a real signed reply delivered into its inbox — both feeds, xmllint --noout, and the xml2js re-parse TASK-37 used.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

The site's comments are the fediverse replies its inbox has already been logging, and they are now published at WordPress's two URLs.

- **`src/federation/replies.ts`** — what a stored inbound activity *means* as a reply, and the only place that reads the JSON-LD. `replyTargetOf(json)` is the definition of the new index column; `replyFrom(activity, nameFor)` projects a logged `Create` into a `Reply` (the note's id, its `url`, its `published` time or the arrival time, its content HTML unsanitised, and a display name); `actorHandle(actorId)` is the `@user@host` fallback. All of it reads the stored activity, so a database thrown away and rebuilt from the log files (TASK-32) yields the same feed.
- **Store** — `MIGRATIONS` gained an optional `run(db)` step, and migration 8 adds `ap_inbox.in_reply_to` with an index and backfills the existing rows *through `replyTargetOf`*, the same function `logInboxActivity` now writes with. `NewInboxActivity` no longer carries the column: it is derived, never supplied. New queries: `countReplies`, `listReplies`, `countRepliesTo`, `listRepliesTo`, all over one `IS_REPLY` predicate spelled once.
- **`src/web/sanitize.ts`** — `sanitizeCommentHtml`, a tokenising allowlist sanitiser.
- **`src/web/comments.ts`** — the join from a logged reply to the post it answers: `postComments`, `siteComments` (over-reading and keeping only replies whose post is still public), `commentCounts`.
- **`src/web/feeds.ts`** — `commentsRssFeed`/`commentsFeedResponse` beside the other builders, `commentsFeedPath`, `COMMENTS_ROOT`, `COMMENTS_TITLE_PREFIX`, `WFW_NAMESPACE`, `DC_NAMESPACE`, and `excerptFromHtml` lifted out of `feedExcerpt` so a comment's `description` is cut the same way a post's is. Every RSS item gained `<comments>`, `<wfw:commentRss>` and `<source:comments count feedUrl>`.
- **`src/web/routes.ts`** — `parseFeedPath` now returns a target union (a listing, or somebody's comments), so `resolveRequest`, `canonicalTarget` and the redirects cover the two new roots with no second parser. `/comments/feed/` is a real route beside the site's three; a post's is resolved through the ordinary `publicDocumentAt`. New export `commentsFeedHref`.
- **Theme** — `partials/feeds.njk` gained `commentsFeedLink(feed, title)`; `base.njk` advertises `/comments/feed/` on every page and the post's own when the renderer sets `commentsFeed`, which `renderDocument` does beside `activityStreams`.
- **Docs** — doc-3 (the feeds table, the redirect paragraph, a new Comments section), doc-4 (the `in_reply_to` index), the package README (route table, reserved words, a Comments section under Feeds, the discovery links and the builder example) and the theme README.

## Decisions

- **The sanitiser is written here rather than added as a dependency.** The package had none, and the alternatives are large for one narrow job (`sanitize-html` and its tree, or `jsdom` + DOMPurify). What makes a hand-written one defensible is that it never passes input through: it tokenises, and *rebuilds* the output from an allowlist, so a tag, an attribute or an entity it does not name cannot reach a reader however it was spelled. Text is decoded and escaped again for the same reason, unclosed elements are closed, `script` and `style` go with their contents, everything else unknown is unwrapped so the words survive, and an `<a>` keeps only an `href` that is `http`, `https` or `mailto` after control characters are stripped — with `rel="nofollow noopener noreferrer"` written on. 13 tests, one of them proving idempotence.
- **Sanitising happens in the feed writer, not in the projection.** `Reply.html` is deliberately the markup as received; `commentItem` sanitises at the last moment before bytes. One place has to be right instead of one per caller, and a future comments screen cannot forget.
- **Comments feeds are RSS 2.0 and nothing else.** `{permalink}feed/atom/` and `/comments/feed/json/` 404. A comments feed is a WordPress artefact read in one format; adding two more builders for a shape nothing subscribes to would be inventing work. `?feed=rss2`/`?feed=rss` on a post permalink 301s to its comments feed, as WordPress served it; `?feed=atom` there names a feed that does not exist, so it is not a feed request and the page is served.
- **A page has no comments feed; a post always has one.** Only posts federate, so nothing can ever have replied to a page — `/about/feed/` is a 404 rather than a permanently empty feed. A post with no replies answers an empty feed rather than 404ing: it exists, and a reader that subscribed before anybody answered should keep polling.
- **The site-wide feed filters on the post, not on the reply.** A reply is shown only when the post it answers is still public, so unpublishing or trashing a post takes its conversation with it. That filtering is after the database has paged, so `siteComments` over-reads (four candidates per kept item) rather than assuming.
- **Resolving a reply's target is slug-first with one lazy fallback.** Almost every `inReplyTo` is the id the slug implies, so it is parsed and checked against the document's own `activityStreamsId`; only when that misses — a post renamed after its first delivery keeps the id it was delivered under — is the whole post index read, once per request, into a map. Proved live: the smoke run replied to the id in the demo post's front matter, which names a different origin from the instance serving it, and the fallback found the post.
- **The author's name is the follower profile the site holds, else `@user@host` from the actor URL.** The actor document is not in the activity, and dereferencing it would be a network round trip per comment shown. Naming actors properly is a later task's problem.
- **The comment counts are resolved into `FeedSource` rather than looked up while writing.** They are part of the feed's validator, so a post answered since is a changed feed: proved by a test that watches the `/feed/` ETag move when a reply arrives. Only RSS resolves them; Atom and JSON have no vocabulary for them, so counting for them would be queries for nothing.
- **The backfill is JavaScript, not SQL.** `MIGRATIONS` grew a `run(db)` hook so migration 8 fills the new column with the very function the writer uses, rather than with a second `json_extract` expression of the same rule that could drift from it.
- **`comments` is now a reserved top-level path**, beside `feed`, and `taxonomy.test.ts`'s drift check pins it against `COMMENTS_ROOT`.

## Verification

Test-first at the existing seams: `cms.app.request` through the public site, `cms.admin` for the log, and the pure sanitiser. 34 new cases — 18 in `src/web/feeds.test.ts` (48 there now), 13 in a new `src/web/sanitize.test.ts`, 6 in `src/admin/store.test.ts`, 1 in `src/federation/inbox.test.ts`, 1 in `src/web/taxonomy.test.ts` — with the file's own strict XML reader proving the bodies well formed.

Mutation-checked, each failing exactly the tests that name it: deleting the item's comment pointers (2 failures), skipping the sanitiser in `commentItem` (1), letting the site-wide feed keep replies to hidden posts (2), and writing `null` instead of deriving `in_reply_to` (3).

The backfill has its own test: a store is opened, a reply logged, the column and the index dropped and the ledger row deleted with a raw `node:sqlite` connection so the file is what version 7 left, and reopening it fills the column from the stored activity.

`src/federation/inbox.test.ts` proves the real Fedify path end to end in process: a signed `Create(Note)` with a `replyTarget` lands in the log with `inReplyTo` set and is counted against the post, and a `Like` is counted as no reply.

**Live, over sockets.** A throwaway script booted a second CMS over the demo's content on a free port with `allowPrivateAddress`, stood up a Fedify peer on another port (the `fed-smoke.ts` shape), and had it send a real signed `Create(Note)` — signature verified, actor dereferenced over HTTP — replying to the object id in the demo post's front matter. It was logged, indexed, and came back out of both `/2026/08/markdown-on-disk/feed/` and `/comments/feed/`, with its `<script>` gone, its `rel="tag"` replaced by `rel="nofollow noopener noreferrer"` and its `&amp;` intact.

**Live, on the demo (port 3000, `pnpm dev`).** Three replies were put into the demo's inbox log through the store, two on one post and one on another:

- **AC #1.** `/2026/08/markdown-on-disk/feed/` 200 `application/rss+xml`, channel `Comments on: Markdown on disk`, link the post, `atom:link rel="self"` its own URL, two items newest first with title, link, `guid isPermaLink="false"`, `pubDate`, `dc:creator`, `description` and `content:encoded`. `/reading-the-index/feed/` — a post nobody answered — 200 with no items.
- **AC #2.** `/comments/feed/` 200 with all three, newest first, each titled `{author} on {post}`.
- **AC #3.** Every one of the five items in `/feed/` carries `<comments>`, `<wfw:commentRss>` and `<source:comments>`; the answered post reads `count="2"` and an unanswered one `count="0"`, both with the right `feedUrl`, and `xmlns:wfw` is on the `<rss>` element.
- **AC #4.** Adding `draft: true` to the demo post 404'd its page *and* its feed and dropped both its replies from `/comments/feed/` (3 items → 1) on the next request; restoring the file brought all three back.
- **AC #5.** Neither `<script`, nor `onclick`, nor `javascript:` survives into either feed; the `javascript:` anchor is unwrapped to its text and the kept link carries the rewritten `rel`.
- **AC #6.** `/comments/feed`, `/comments/feed/rss/`, `/comments/feed/rss`, `{permalink}feed`, `{permalink}feed/rss/`, `{permalink}/?feed=rss2` and `?feed=rss` each 301 in one hop to the canonical URL; `/comments/feed/atom/`, `/comments/feed/json/`, `/comments/`, `{permalink}feed/atom/`, `/about/feed/` and an unknown permalink's feed all 404.

`xmllint --noout` clean on all six feed URLs. An independent sax-based re-parse (`xml2js`, the check TASK-37 used) asserted every element above and reported both faults in a deliberately damaged copy, so it is not vacuous. Caching: all three comments feeds carry an ETag and answer their own `If-None-Match` with 304, and four feed URLs produced four distinct ETags. `feedSize: 2` capped both comments feeds at two on the next request. The demo's overridden `post.njk` still advertised `Comments on: Markdown on disk`, which is the point of putting `commentsFeed` on the context.

From the repository root: `pnpm build` clean; `pnpm test` 676 pass / 0 fail (`@geekity/cms`) and 11 / 0 (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean.

The demo was put back: `site.json` and the post file restored byte for byte (`git status` shows only the pre-existing `timezone`/`avatar` edit and `content/uploads/`), the three seeded rows deleted from `apps/demo/data` so `ap_inbox` is empty again, the scratch scripts removed, and the server stopped — `pgrep -fl "tsx watch"` and `lsof -nP -iTCP:3000` both report nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Published the site's comments — which are the fediverse replies its inbox has been logging all along — at WordPress's two URLs: `{permalink}feed/` for one post, titled `Comments on: {title}`, and `/comments/feed/` for the whole site, where each item names the post it answers. Both are RSS 2.0, both honour `feedSize`, and both are empty rather than absent when nobody has answered a post that exists. Every RSS post item now says where its own comments are three ways — `<comments>`, `<wfw:commentRss>` and `<source:comments count feedUrl>` — so a reader that already understands a WordPress feed understands this one, and can say '2 comments' without fetching anything.

Three decisions carry it. A reply's meaning is read back out of the stored JSON-LD rather than out of columns beside it, and the one new column, `ap_inbox.in_reply_to`, is derived by the same function at write time and in migration 8's backfill — so the index stays disposable, which is what TASK-32's rebuild from the log files needs. The site-wide feed filters on the post rather than the reply, so unpublishing or trashing a post takes its conversation with it and its own feed 404s alongside it. And the note's HTML — markup a stranger wrote — is sanitised at the last moment before it becomes bytes, by a tokenising allowlist sanitiser written here rather than pulled in: it never passes input through, it rebuilds the output, so a tag, attribute or entity it does not name cannot reach a reader.

Verified by 34 new node:test cases across five files, four of them mutation-checked, including a backfill test that puts a database back the way version 7 left it and reopens it, and an inbox test that delivers a signed `Create(Note)` through the real Fedify path. Then live: a second CMS and a Fedify peer on two ports exchanged a genuinely signed reply over sockets and it came back out of both feeds sanitised; and on the running demo all six acceptance criteria were walked with curl — six feeds `xmllint` clean and re-parsed by an independent sax parser that also reported both faults in a damaged copy, thirteen redirects and 404s each landing in one hop, an unpublished post dropping its two replies from the site-wide feed and 404ing its own, and `feedSize` capping both. `pnpm build`, `test` (676 + 11), `test:11ty` (9 + 5), `typecheck`, `lint` and `format:check` all pass; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
