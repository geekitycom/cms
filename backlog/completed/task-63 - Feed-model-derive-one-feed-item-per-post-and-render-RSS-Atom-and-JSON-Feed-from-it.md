---
id: TASK-63
title: >-
  Feed model: derive one feed item per post and render RSS, Atom and JSON Feed
  from it
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:08'
updated_date: '2026-09-13 01:51'
labels:
  - web
milestone: m-10
dependencies:
  - TASK-62
  - TASK-65
references:
  - packages/cms/src/web/feeds.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/documents.ts
documentation:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: task
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/feeds.ts has no feed model: FeedSource is a bag of inputs and rssItem, atomEntry and jsonFeedItem each read the Document again. They already disagree. RSS keys an item by its ActivityStreams object id where Atom and JSON Feed use the permalink; RSS lists categories and tags where the others list tags only; RSS falls back to an excerpt of the HTML where the others print the description or nothing. Introduce a feed item: one shape derived once per document and site (both ids, title, link, published and updated instants, author, categories, tags, summary, content HTML) with the three serialisers rendering from it and the envelope (channel, cloud and hub elements, headers, fingerprint) unchanged. This task is the refactor only: each format keeps the id, terms and summary it prints today, so every feed is byte-identical before and after, and TASK-64 then changes what the item says. The comments feed keeps rendering the Conversation module's entries (TASK-62) and is not part of the post item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One function derives a feed item from a document and the site, and rssItem, atomEntry and jsonFeedItem take an item rather than a document
- [x] #2 The feed item and the three serialisers are tested directly on fixtures: the item's derivation in one test file, and each serialiser given the same item
- [x] #3 Every feed the site serves is byte-identical to before the change for the same content, including ETags, proved by feeds.test.ts passing without a changed expectation and by a snapshot of the three formats over the demo content taken before and after
- [x] #4 web/feeds.ts is split so the item, the serialisers and the XML plumbing are separate modules
- [x] #5 doc-3's feeds section names the item
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Snapshot the three post feeds, the taxonomy feeds and both comments feeds over a copy of the demo content (plus fixtures the demo lacks: a post carrying a stored `activitypub.id`, one with no description and a long body, one with nothing but a title) at HEAD, bodies and ETags alike. This is the before half of the byte-identity proof.
2. Split web/feeds.ts into modules along a DAG so nothing imports in a circle:
   - `web/feed-xml.ts` — the XML plumbing: escapeXml, cdata, element, optionalElement, link, author, rfc822, and the three namespaces a feed declares.
   - `web/feed-source.ts` — what a feed is: the formats, the URL shape, splitFeedPath, the notify server, feedSize, feedLanguage, the generator, and the FeedSource/CommentFeedSource/FeedComment/FeedIdentity types.
   - `web/feed-item.ts` — the feed item: the FeedItem shape, feedItem()/feedItems() deriving one per document and site, and the excerpt rules.
   - `web/feed-rss.ts`, `web/feed-atom.ts`, `web/feed-json.ts` — one serialiser per format, each rendering an item rather than reading a Document.
   - `web/feeds.ts` — the response layer (feedResponse, commentsFeedResponse, headers, link header, fingerprints) and the barrel every existing importer keeps importing from, so routes.ts, index.ts, sitemap.ts and conversation.ts are untouched.
3. Test-first at the new seams: `web/feed-item.test.ts` for the derivation (both ids including a stored one, the summary rule, terms, instants, author and creator fallback, comment pointers), and `web/feed-formats.test.ts` giving one fixture item to rssItem, atomEntry and jsonFeedItem and asserting what each prints today.
4. Derive the item once per document and render from it. Each format keeps exactly the id, terms and summary it prints today: RSS keys by the ActivityStreams object id with isPermaLink="false", lists categories then tags, and prints the description-or-excerpt summary; Atom and JSON key by the permalink, list tags only, and print a summary only when the post carries a description. The item therefore carries both `id` and `link`, both `categories` and `tags`, and both `description` and `summary` — TASK-64 is what collapses those pairs.
5. Re-run the snapshot and diff it against the before file; it must be empty. Run feeds.test.ts with no changed expectation.
6. Name the item in doc-3's feeds section.
7. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split web/feeds.ts (1041 lines) into six modules along a DAG, so nothing imports in a circle:

- `web/feed-xml.ts` (122) — escaping, CDATA, indented elements, links, authors, rfc822 and the three namespaces. Imports nothing of the feed.
- `web/feed-source.ts` (350) — what a feed is: formats, URL shape, splitFeedPath, notify server, feedSize, feedLanguage, generator, EMPTY_FEED_UPDATED, and the FeedSource/CommentFeedSource/FeedComment/FeedIdentity types.
- `web/feed-item.ts` (204) — the model: FeedItem, feedItem()/feedItems(), and the excerpt rules that feed its summary.
- `web/feed-rss.ts` (236), `web/feed-atom.ts` (92), `web/feed-json.ts` (115) — one serialiser per format. rssItem, atomEntry and jsonFeedItem each take a FeedItem and nothing else; none of them sees a Document.
- `web/feeds.ts` (200) — the response layer (feedResponse, commentsFeedResponse, headers, Link header, both fingerprints) and the barrel that re-exports the rest, so routes.ts, web/index.ts, sitemap.ts, conversation.ts, notify.ts, render.ts and admin/settings.ts import exactly what they did before.

Design decisions:

- The item carries three pairs the formats still disagree about — `id`/`link`, `categories`/`tags`, `description`/`summary` — because this task is the refactor and every format must print what it printed before. TASK-64 collapses each pair: RSS's guid becomes the permalink where it is one, all three list both taxonomies, and all three print `summary`. The disagreement is now visible in one fixture (feed-formats.test.ts) instead of spread over three functions.
- Two author fields: `author` is the post's own (Atom's <author>, JSON's authors) and `creator` is that resolved against the site's (RSS's dc:creator, which has nowhere else to say it). Preserved rather than unified, again for byte-identity.
- `comments` on the item replaces the old commentPointers(document, source): derived only when the feed resolved the counts, so a builder that did not still publishes nothing rather than "0 comments".
- The item's id keeps the exact old expression `activityStreamsId(document, baseUrl) ?? link` rather than postObjectId, so a page or a draft that somehow reached a feed still falls back to its address.
- A comment is not a FeedItem: commentsRssFeed keeps rendering the Conversation module's FeedComments (TASK-62), untouched.

Validation:

- `src/web/feeds.test.ts` passes unchanged — git diff on it is empty — 60 tests.
- Byte-identity snapshot: a script served /feed/, /feed/atom/, /feed/json/, the tag and category feeds in all three formats, /comments/feed/ and one post's comments feed over a copy of apps/demo/content plus three fixtures the demo lacks (a post carrying a stored activitypub.id of https://example.com/?p=813, one with no description and a 55+ word body, one with nothing but a title). Bodies, ETags, Last-Modified, Content-Type and Link headers were captured at HEAD and again after the change: `diff` is empty and both files hash to 8fc2be8d57f300d6ce9a5618e30369afa0cd5db4cf4af6302aed45724de7f739.
- New tests: src/web/feed-item.test.ts (12) for the derivation, src/web/feed-formats.test.ts (6) giving one fixture item to all three serialisers.
- pnpm build, pnpm test (1447 + 14 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Introduced the feed item: `feedItem(document, context)` in `packages/cms/src/web/feed-item.ts` derives one shape per post and site — the ActivityStreams object id beside the permalink, title, published and updated instants, author and creator, categories and tags, description and summary, rendered HTML, Markdown, and the counted comment pointers — and `rssItem`, `atomEntry` and `jsonFeedItem` now render that item instead of reading the Document a fourth, fifth and sixth time. web/feeds.ts was split into feed-xml.ts (plumbing), feed-source.ts (what a feed is), feed-item.ts (the model), feed-rss.ts / feed-atom.ts / feed-json.ts (the serialisers) and feeds.ts itself (the response layer and the barrel), so every existing importer is untouched.

Nothing on the wire moved: each format still prints the id, terms and summary it printed before, which is what leaves TASK-64 free to change them under decision-12. Proved two ways — src/web/feeds.test.ts passes with no changed expectation (60 tests, git diff empty), and a before/after snapshot of /feed/, /feed/atom/, /feed/json/, the tag and category feeds in all three formats, /comments/feed/ and a post's comments feed over the demo content plus a migrated post carrying a stored `?p=813` id, an undescribed post and a bare one is byte-identical, headers and ETags included (both files SHA-256 8fc2be8d…). New unit tests cover the derivation (feed-item.test.ts) and give one fixture item to all three serialisers (feed-formats.test.ts). doc-3's feeds section now names the item. pnpm build, test, typecheck, lint and format:check all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
