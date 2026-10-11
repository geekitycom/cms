---
id: TASK-339
title: >-
  Term archive URLs answer WordPress's lowercase slugs and fall through to
  declared redirects
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 23:01'
updated_date: '2026-10-11 00:55'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/web/taxonomy.ts
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/urls.tsv
priority: high
ordinal: 298800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found building the andrewshell.org redirect generator (asdo_geekity scripts/redirects, phase 4). Two gaps in taxonomy routing. (1) Case. Geekity serves a term's archive at the term's exact spelling: /category/rssCloud/, /category/AI/, /category/WordPress/. WordPress served them at their lowercase slugs: /category/rsscloud/, /category/ai/, /category/wordpress/, and their feeds (the baseline has /category/rsscloud/feed/, a feed people subscribe to; feed-guids.tsv category_rsscloud_feed.xml). Those 3 archives and 3 feeds now 404. taxonomyRedirects would paper over it, but it is documented for renamed terms, and these were not renamed: WordPress slugs are lowercase by design, so every WordPress import with a mixed-case term hits this. (2) Shadowing. taxonomyArchive and parseFeedPath claim every /{base}/{term}/ path and its feeds, even for a term nothing carries, and answer 404 before declared redirects run. So the migration's entries for /category/general/, /category/general/feed/, feed/atom/ and feed/rss/ (D5 dropped the General category) never answer. feed/rdf/ and feed/rss2/ do. taxonomyRedirects can't express 'go to /'. Proposal: a request for a term archive or its feed matches the term case-insensitively and answers 301 to the canonical spelling (or serves it, decided in the task); a term path naming no term in use falls through to the next handler, so a declared redirect can answer it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /category/rsscloud/ and /category/rsscloud/feed/ reach the rssCloud archive and feed (301 to the canonical spelling, or served there), and the same for tags and every feed variant
- [x] #2 A term archive or feed path for a term no published post carries falls through to declared redirects and taxonomyRedirects before answering 404
- [x] #3 On the andrewshell.org site, /category/general/ and all its feed variants answer the 301 to / declared in content/_data/redirects/legacy.json
- [x] #4 The README's taxonomy section documents case matching and the fall-through
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Split term-path parsing from term resolution in web/routes.ts: parseListingPath yields a term only when a published post carries it, resolved case-insensitively to the site's spelling (tags already fold; categories now fold too, exact spelling preferred). This is the one place that decides whether /{base}/{term}/ is an archive.
2. taxonomyArchive and parseFeedPath then answer only for carried terms: a carried term asked in another casing 301s to termHref (decision: 301, not serve, matching TASK-308 tags and the trailing-slash/page-1 collapses: one URL per resource). Delete the empty-term guards in listing(), feed(), canonicalTarget and taxonomyArchive that the parse now makes unreachable.
3. Move the taxonomyRedirects lookup out of taxonomyArchive and feed() into the fall-through, next to redirect_from (movedHref), covering archive pages and every feed variant; then declared redirects (findPathRedirect), then 404.
4. Tests first: category casing for archive, pages, every feed variant and ?feed=; uncarried term paths (archive, page N, feed/, feed/atom/, feed/rss/, feed/rdf/, feed/rss2/, feed/json/, ?feed=) answered by a _data/redirects/legacy.json; renames still redirect archive and feed.
5. README taxonomy section: case matching and the fall-through.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl a scratch site with legacy.json.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: a carried term asked in another casing answers 301 at the site's spelling rather than being served there. One URL per resource, and it matches how the site already collapses /page/1/, a missing trailing slash, /feed/rss/, and tag casings (TASK-308). A ?feed= query rides along on that redirect.

One place decides: parseListingPath yields a term only when a published post carries it (carriedSpelling: tags by tagKey; categories exact spelling first, then the most used one differing only in case). So taxonomyArchive, parseFeedPath, canonicalTarget and the .json listing path all see an uncarried term as no listing, and the request falls through. The renames (taxonomyRedirects) moved out of taxonomyArchive and feed() into the fall-through next to redirect_from (renamedTermHref, covering archive pages and feeds), then declared redirects, then 404.

Deleted: movedTerm, isCarriedTagFeedInAnotherCasing, asTheSiteSpellsIt, and the empty-term guards in listing(), feed(), canonicalTarget and taxonomyArchive that the parse made unreachable. This also fixes /tag/nothing/feed/rss/, which used to 301 to a 404.

Not changed: feed/rdf/ and feed/rss2/ are not feed aliases on this site, so for a carried term they 404 at any casing (they were never served); for an uncarried one they now reach declared redirects like the rest. Declared redirect sources stay case-sensitive.

AC#3 proved on a scratch site built for it (scratchpad/site339, three posts in category rssCloud, content/_data/redirects/legacy.json with the six /category/general/ sources copied from the andrewshell.org file): /category/general/, feed/, feed/atom/, feed/rss/, feed/rdf/, feed/rss2/ and /category/general all answer 301 at /; ?feed=rss2 answers 301 at /?feed=rss2. /category/rsscloud/ and its feed/, feed/atom/, feed/rss/ and page/2/ 301 to the rssCloud spelling; /category/rssCloud/ and its feed 200; /category/nothing/ and its feed 404.

Validation: pnpm build, pnpm test (cms 5429 pass, 0 fail; all packages green), pnpm typecheck, pnpm lint, pnpm format:check all pass. New tests in packages/cms/src/web/term-paths.test.ts failed before the change (/category/rsscloud/ answered 404, /category/general/ answered 404, /tag/nothing/feed/rss/ answered 301).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Term archive and feed paths now match their term case-insensitively and 301 to the site's spelling, so WordPress's lower-case /category/rsscloud/ and its feeds reach the rssCloud archive. A term path whose term no published post carries is no longer claimed by the archive or feed handlers: parseListingPath is the one place that decides, and the request falls through to taxonomyRedirects, then the declared redirects in _data/redirects.json and _data/redirects/*.json, then 404. README documents both. Verified by web/term-paths.test.ts (failing before), the full pnpm build/test/typecheck/lint/format:check run, and curl against a scratch site with a legacy.json.
<!-- SECTION:FINAL_SUMMARY:END -->
