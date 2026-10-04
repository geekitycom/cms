---
id: TASK-256
title: Show a titled post's heading when it has no body text
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 00:20'
updated_date: '2026-10-04 01:12'
labels:
  - theme
  - content
dependencies: []
priority: medium
type: bug
ordinal: 271800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me (0.19.0) the repost /2026/10/scientific-calculator/ has title 'Scientific Calculator' and no body. The title reaches <title>, og:title and JSON-LD, but the page shows no heading: the theme's named flag comes from isNamedPost in packages/cms/src/content/post-type.ts, which (following Post Type Discovery) counts a post with a name and no content as unnamed, so the default theme takes the untitled layout. A title the author typed should show. Separate whether the page shows a heading from the post type: a post whose title is non-empty and not just its content's first words shows its header, on its page and in listings, while post type discovery and mf2 keep their current results unless a test shows they are wrong too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A like, repost or bookmark with a title and no body shows its title as the page heading and in listings, with the citation after it (TASK-241's order)
- [x] #2 A note whose name only repeats its content still shows no heading; post type discovery results are unchanged
- [x] #3 Tests cover a titled bodiless repost, like and bookmark
- [x] #4 A titled post with no body has its title as the item title in RSS, Atom and JSON Feed, and a title that only repeats the opening words still gives none; FEED_ITEM_REVISION is bumped so cached feeds are refetched
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Red tests: post-type.test.ts gets showsTitle cases (titled bodiless repost, like, bookmark show; a name that only repeats the content does not; untitled does not) and pins discoverPostType/postTypeOf for the same posts (repost, like, bookmark, note) so PTD is unchanged. citation-placement.test.ts gains a titled bodiless repost, like and bookmark: page order header, citation, e-content; listing order kicker, feed-title, citation, feed-more; and a note whose title repeats its words with no header.
2. Add showsTitle(document) to content/post-type.ts: a non-empty title that the post's text (content, else summary) does not open with; empty text counts as not opening with it. isNamedPost keeps the PTD rule (no content means no name).
3. web/context.ts: named = showsTitle(document); update the DocumentContext doc. Theme layouts need no change since they already branch on named.
4. Leave discoverPostType, postTypeOf, federation (article.ts Note/Article via postTypeOf, citations.ts), JSON-LD (reads title directly) and feed-item (isNamed for the item title, keyed by FEED_ITEM_REVISION) on the PTD rule.
5. Theme README h1 section: describe a titled post with no words.
6. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check; curl a titled bodiless repost on the demo server; stop it.

7. Follow-up from the coordinator: move web/feed-item.ts's item title to showsTitle test first, bump FEED_ITEM_REVISION to 12, refresh the ETag fixtures, delete isNamed once nothing calls it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first. citation-placement.test.ts gained a titled repost, like and bookmark with no description and no body, plus a note whose title repeats its words. With the old rule the six page and listing order tests failed on a missing header and title (positions -1 while the citation printed), as did the mf2 pins for the three bare posts; the echo note passed already. post-type.test.ts gained showsTitle cases that also pin postTypeOf (repost, like, bookmark, note) for the same documents.

Added showsTitle(document) in content/post-type.ts: a non-empty title the text (content, else description) does not open with, true when there is no text. isNamed and isNamedPost keep the Post Type Discovery rule (no text means no name); both share a small textOf helper. web/context.ts sets named from showsTitle, so every theme branch on named moves with it: layouts/post.njk (header then citation), partials/post-list.njk (title then citation), layouts/search.njk (p-name on the result heading) and partials/recording.njk (recording label).

Left on the PTD rule: discoverPostType and postTypeOf, federation article.ts (object type via postTypeOf) and federation citations.ts, and feed-item.ts, which uses isNamed for the feed item title under FEED_ITEM_REVISION. JSON-LD reads title directly and never used isNamed. On the page, mf2 now finds a p-name on a titled bodiless post (the author's title), and the parsed type is still repost, like or bookmark because the citation decides first.

Live check: demo server with a playground repost titled Scientific Calculator, no body. Page: post-header line 84, p-name 88, u-repost-of h-cite 92, e-content 96, no screen-reader h1. Home listing: feed-title 106, h-cite 109, feed-more 112. Server stopped, playground post removed.

Validation: pnpm build, pnpm test (3958 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.

Feed follow-up (coordinator request; this supersedes the earlier note that left feed-item.ts on the PTD rule). Test first: feed-item.test.ts gained a titled bodiless repost, like and bookmark (title expected) and a title that repeats the opening words (no title), and the revision pin moved to 12. citation-placement.test.ts gained RSS, Atom and JSON Feed checks for the three bare posts and the echo note. Red before the change: the three feed tests failed with no <title>A bare ...</title>, and the unit tests failed with 11 !== 12 and a missing title.

feed-item.ts now titles an item when showsTitle(document) is true. FEED_ITEM_REVISION went from 11 to 12, and its doc comment names the change. Refreshed ETag fixtures: feed-enclosure.test.ts BEFORE_RECORDINGS (the bytes' sha256 was unchanged, only the three ETags moved) and __testing__/anonymous-pages.golden.json via GEEKITY_UPDATE_GOLDEN=1 (only the feed ETag changed). isNamed had no caller left, so it is deleted. Its reply tests now assert showsTitle with the same results, and isNamedPost stays as the note/article tail of discoverPostType.

Live check: demo on GEEKITY_PORT=3456, because an unrelated process held port 3000. For a titled bodiless repost, RSS and Atom print <title>Scientific Calculator</title>, JSON Feed has title 'Scientific Calculator', and the page has its p-name h1. Server stopped, playground post removed.

Validation: pnpm build, pnpm test (3964 + 30 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
If the author gives a post a title that is not just its opening words, that title now shows even when the post has no body. A titled like, repost or bookmark opens on its header and then its citation, on its page and in listings, and its RSS, Atom and JSON Feed items carry the title. The theme's named flag and the feed item title both come from a new showsTitle(document) in content/post-type.ts. Post Type Discovery and the federated object type keep the spec's rule. isNamed is deleted, and FEED_ITEM_REVISION is now 12 so cached feeds are refetched. Verified with new citation-placement, post-type and feed-item tests, which failed on the old rule and pass now. Also verified with live curls of a titled bodiless repost's page and of all three feeds, and with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
