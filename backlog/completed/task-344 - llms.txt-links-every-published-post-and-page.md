---
id: TASK-344
title: llms.txt links every published post and page
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 13:33'
updated_date: '2026-10-11 14:00'
labels:
  - public-site
dependencies:
  - TASK-343
references:
  - packages/cms/src/web/llms.ts
priority: medium
type: enhancement
ordinal: 303800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/web/llms.ts writes the site's pages and then a "Recent posts" section from the same newest posts the feed carries (feedSize, 10 by default), with no dates or excerpts. The andrewshell.org migration found prod's llms.txt lists about 50 posts (asdo_geekity _local/PLAN.md, 2026-10-11).

Andrew, 2026-10-11: llms.txt should link to all pages and posts.

List every published post and page, each linking to its Markdown representation as today, with a post's date and its excerpt (description, or the summary the feeds use). Keep it one file: a large site gets a long llms.txt. Drafts, future-dated, unlisted, private and trashed documents stay out, as they stay out of the sitemap. A site's own content/llms.txt still replaces the generated one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /llms.txt lists every published post and every published page, each linking to its Markdown representation
- [x] #2 Each post line carries its date and its excerpt; an untitled post or page uses the label TASK-343 gives it
- [x] #3 Drafts, future-dated, unlisted, private and trashed documents are absent, by the same rule the sitemap uses
- [x] #4 A site's own content/llms.txt still replaces the generated file
- [x] #5 docs/public-site.md describes what llms.txt lists
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: add listListed(), every post and page under LISTED_CLAUSE in one SELECT, newest first. Batch hydration so a listing of N rows reads tags, categories and redirects in one query each (json_each over the paths), not three lookups per row; hydrateOne becomes hydrateAll of one row.
2. routes.ts: one listedDocuments(c) returning { posts, pages } from listListed() with the isListed recheck; sitemapUrls and llmsIndex both use it.
3. llms.ts: LlmsEntry gains date (calendar day in the site timezone); post lines read '- [label](md url): YYYY-MM-DD. excerpt' with the excerpt from feedExcerpt; section renamed from Recent posts to Posts; every listed post, no feedSize cap.
4. Tests first in llms.test.ts for each AC (all posts beyond feedSize, date and excerpt, untitled label, unlisted/private/trashed/draft/future absent, own file wins) and a store test for listListed.
5. Benchmark a 5000-post site before and after (median ms, 304 path) and record it.
6. docs/public-site.md: describe what llms.txt lists.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built. listedDocuments(c) in web/routes.ts is now the one reading of what the public site lists; sitemapUrls and llmsIndex both take { posts, pages } from it. It calls the new ContentStore.listListed() (one SELECT under LISTED_CLAUSE over posts and pages) and rechecks isListed with the store clock, as the sitemap did.

Store hydration batched: hydrateAll reads tags, categories and redirect_from for the whole row set in one query each (path IN json_each(?)); hydrate(row) is hydrateAll([row])[0]. Deleted tagsOf, categoriesOf, hydrateOne and the per-path tagsFor/categoriesFor/redirectsFor statements. siteSpellings() is now asked once per listing, not once per row. Every listing (feeds, archives, sitemap, search) benefits.

llms.txt: section 'Recent posts' renamed 'Posts'; every listed post, no feedSize cap; a post line reads '- [label](md url): YYYY-MM-DD. summary', the date being calendarDayIn(date, siteTimezone(site)) and the summary feedExcerpt(document). Pages keep their description. Untitled documents use postLabel (TASK-343). ETag stays the body hash and Last-Modified the newest entry, so any change to what the file says changes both.

Benchmark, 5000 posts and 20 pages, in-process app.request, median of 5 (scratchpad llms-bench/bench.mts): before, llms.txt 1.3 ms (10 posts) and sitemap 165 ms, store.listPosts() of 5000 rows 42 ms; after, llms.txt 75-78 ms for an 850 KB file, sitemap 110 ms, listPosts 24 ms. Raw SELECT alone is 8 ms. In llms.txt the largest cost is calendarDayIn on the Temporal polyfill, about 35 ms for 5000 dates; feedExcerpt is 7 ms. A 304 costs the same as a 200, because the body is built to compute the ETag, as for the sitemap.

Verified on a served scratch site (dist build, port 3497): /llms.txt lists the untitled post by its first words with date and excerpt, omits unlisted, private, draft, future and trashed posts, every link answers 200 text/markdown, If-None-Match answers 304, and content/llms.txt replaces the file.

Validation: pnpm build, pnpm test (cms 5455 pass, 0 fail), pnpm typecheck, pnpm lint (doc links included), pnpm format:check all pass. llms.test.ts failed first on the four new listing tests before the code changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/llms.txt now lists every post and page the site lists, by the sitemap's own rule: both read listedDocuments(c), which takes ContentStore.listListed() (one SELECT under LISTED_CLAUSE) and rechecks isListed. Each post line carries its date in the site timezone and the feed summary (feedExcerpt); untitled documents use postLabel. 'Recent posts' is now 'Posts'. Store hydration reads tags, categories and redirects in one query each per listing, not three lookups per row. A 5000-post site serves its 850 KB llms.txt in about 75 ms and its sitemap in 110 ms (was 165 ms). content/llms.txt still wins. docs/public-site.md describes the two sections. Verified with llms.test.ts, store.test.ts, the full suite and curl against a served scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
