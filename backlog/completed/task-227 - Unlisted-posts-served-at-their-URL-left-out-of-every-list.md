---
id: TASK-227
title: 'Unlisted posts: served at their URL, left out of every list'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 01:32'
updated_date: '2026-10-03 12:45'
labels:
  - micropub
  - federation
  - interop
dependencies: []
priority: medium
type: feature
ordinal: 242800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-219's visibility decision: support public and unlisted, refuse private. An unlisted post keeps its page (with noindex) and drops out of the home page, archives, tag and category pages, feeds, sitemap, search, llms.txt and IndexNow. It federates with to: followers and cc: Public, the swap of the public addressing in packages/cms/src/federation/article.ts, so Mastodon shows it as unlisted. Webmentions still go out. Today isPublicDocument (packages/cms/src/web/documents.ts) and the SQL predicate the content index answers with decide served and listed as one rule; split them. TASK-222 accepts visibility=public and refuses unlisted with 'does not publish unlisted posts yet' in packages/cms/src/micropub/create.ts, and advertises visibility ["public"] in q=config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post can be unlisted from the admin editor and from Micropub (visibility=unlisted on create and update), stored as front matter, and q=source returns it
- [x] #2 An unlisted post's page answers 200 with a noindex robots meta, and the post is absent from the home page, archives, tag and category pages, every feed, the sitemap, search, llms.txt and IndexNow pings
- [x] #3 An unlisted post federates with to: followers and cc: Public on Create and Update
- [x] #4 q=config advertises visibility ["public", "unlisted"] and decision-27's amendment says so
- [x] #5 README and doc-2 document unlisted posts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: content/visibility.ts holds the front matter key `visibility`, the Visibility type ('public' | 'unlisted') and visibilityOf(document), read from extra like pinned and lang. Absent, null or 'public' is public; any other value is unlisted, so a hand-typed 'private' fails closed (kept off lists, still served).
2. Split the rule: web/documents.ts isPublicDocument becomes isServed (draft, trash, schedule) plus isListed (served and public). store.ts names SERVED_CLAUSE and LISTED_CLAUSE once and every public query uses one of them: listings, counts, tags, categories, term usage, author archive, pinned, neighbours and search ask LISTED; former permalinks, due and next-due ask SERVED. Package export isPublicDocument is replaced by isServed and isListed (breaking).
3. Callers: page, object, comments, contact, webmention, embeds, admin view links ask isServed; sitemap, llms.txt pages, IndexNow, the feed notifier and the site-wide comments feed ask isListed. Outbox and featured follow listByAuthor/listPinnedByAuthor (listed).
4. Page: an unlisted document's responses carry X-Robots-Tag noindex and the default theme prints <meta name=robots content=noindex> from a noindex context flag.
5. Federation: postAddressing(document) gives to Public, cc followers for public and to followers, cc Public for unlisted; the object, Create and Update use it. Relays are not sent activities about an unlisted post. A public <-> unlisted edit is an ordinary Update with the new addressing.
6. Micropub: visibility leaves ACCEPTED_WITHOUT_EFFECT and maps to the editor's visibility field on create and update; private keeps its own refusal; q=source returns visibility; q=config advertises [public, unlisted].
7. Admin editor: a Visibility select for posts and pages, written as visibility: unlisted or removed.
8. Docs: decision-27 amendment, README, doc-2, theme README, Eleventy example config.
9. Verify: pnpm build, test, typecheck, lint, format:check; curl a running site with an unlisted post.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: visibility lives in front matter extra, like pinned and lang. content/visibility.ts holds the key, the Visibility type ('public' | 'unlisted') and visibilityOf; absent, null or 'public' is public and any other value is unlisted, so a hand-typed 'private' fails closed (off the lists, still served).

Two rules: web/documents.ts isPublicDocument is now isServed (draft, trash, schedule) plus isListed (served and public). The package export isPublicDocument is gone; isServed and isListed replace it (apps/demo eleventy test migrated). store.ts names SERVED_CLAUSE and LISTED_CLAUSE once; listings, counts, tag/category counts, term usage, author archive, pinned (featured), neighbours and search ask LISTED; former-permalink redirects ask SERVED; nextDue and dueSince are unchanged. No migration: extra is already indexed as JSON.

Surfaces: sitemap pages, llms.txt pages, IndexNow, the feed notifier and the site-wide comments feed (stored comments, federated replies and quotes) ask isListed. Pages, objects, comments and contact forms, webmentions, embeds and admin View links ask isServed. The outbox and featured collection follow listByAuthor/listPinnedByAuthor, so they leave unlisted posts out (Mastodon would keep them on the profile; chosen as the conservative reading). Menu pages flagged by the owner stay in the menu.

Page: an unlisted document's every representation carries X-Robots-Tag: noindex (theme-independent), and the default theme prints the robots meta from a noindex context flag. Public pages' bytes are unchanged, so no golden or FEED_ITEM_REVISION change.

Federation: addressing(document) in federation/article.ts gives the object, Create and Update to Public cc followers, or to followers cc Public when unlisted. Delete is unchanged. Relays are sent nothing about an unlisted post (a relay pushes into public timelines). A public <-> unlisted edit is an ordinary Update with the new addressing. Likes and Announces of an unlisted citing post keep their existing addressing (not in scope).

Micropub: visibility left ACCEPTED_WITHOUT_EFFECT and maps to the editor's visibility field on create and update; private keeps its own refusal; any other value is refused by name; q=source returns visibility for every post; q=config advertises VISIBILITIES. Editor: a Visibility select for posts and pages.

Docs: decision-27 amendment, root README (Micropub table, editor), package README (Unlisted posts section, sitemap), theme README (noindex), doc-2 (front matter row, Visibility section, Micropub), doc-3 (sitemap rule). Not done: the Eleventy example config does not read the key, so an Eleventy build lists unlisted posts; documented in doc-2 and the package README as a gap.

Verification: new src/web/unlisted.test.ts (failed before: no x-robots-tag, the unlisted post on /, and the comments feed check failed with the site-wide filter reverted); notify, IndexNow, editor, delivery, relay, article/outbox and Quill/Micropub tests. pnpm build && pnpm test (3619 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check exit 0. Live site via createCms on :4327 with one unlisted post: /hushed/ 200 with x-robots-tag noindex and the robots meta; /newer/ has neither; /, tag, category, all three feeds, tag feed, sitemap.xml, search HTML and JSON, llms.txt, /index.json and the neighbours' pages contain no 'hushed'. Server stopped.

Unrecognized visibility (follow-up): a visibility value that is neither absent/null/public nor unlisted (a hand-typed private, a misspelling, a number) no longer reads as unlisted. It hides the document like a draft. content/visibility.ts: visibilityOf returns StoredVisibility = Visibility | { unrecognized: string } (the value as the file spells it; non-strings as JSON), and visibilityText gives the text a form or q=source shows. isServed adds 'a recognized visibility'; SERVED_CLAUSE adds the same test as VISIBILITY_SQL IN (VISIBILITIES), and LISTED_CLAUSE stays SERVED_CLAUSE AND VISIBILITY_SQL = 'public'. content/sync.ts's own copy of the served rule (published/unpublished events) now calls isServed. Effects: the URL, .md, .json, ActivityStreams object and redirect_from URLs answer 404; the post is on no list; delivery withdraws an announced post with a Delete (isFederatedDocument follows isServed). Editor: the stored value is a third, selected option labelled '<value> (not recognized)' with a hint that the post is hidden until Public or Unlisted is chosen; a save that sends it back keeps the stored value as the file spells it; choosing Public or Unlisted replaces it. The posts list marks it Hidden. Micropub q=source returns the stored value; an update that does not name visibility keeps it. Tests: store.test.ts pins served/listed for twelve values and checks getByFormerPermalink and listPosts against isServed/isListed (mutation-checked: dropping the visibility test from SERVED_CLAUSE or from isServed each fails it); unlisted.test.ts (404s, absent from every surface); posts.test.ts (editor round trip, Unlisted serves it, Hidden marker); quill.test.ts (q=source, update keeps); delivery.test.ts (Delete, no Update). Docs: README, package README, doc-2. Gate: pnpm build, test (3627 + 30), typecheck, lint, format:check exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Unlisted posts (TASK-227). visibility: unlisted in front matter, set from the admin editor's Visibility select or Micropub (create, update, q=source, q=config [public, unlisted]; private still refused). The single public rule is split into isServed and isListed, in TypeScript and as SERVED_CLAUSE/LISTED_CLAUSE in the content index, and every surface asks the right one: an unlisted post keeps its page (200, X-Robots-Tag and robots meta noindex) and is absent from the home page, archives, tag/category/author pages, neighbours, every feed including site comments, sitemap, search, llms.txt, IndexNow, feed pings, outbox and featured. It federates to followers with Public in cc on Create and Update, a public/unlisted edit sends an Update with the new addressing, and relays get nothing. Breaking: the isPublicDocument export is replaced by isServed and isListed. Verified with new and updated tests, the full gate run, and curl against a live site.
<!-- SECTION:FINAL_SUMMARY:END -->
