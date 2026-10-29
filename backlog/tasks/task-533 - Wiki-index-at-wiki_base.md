---
id: TASK-533
title: Wiki index at /<wiki_base>/
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T20:25:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-530
references:
  - decision-66
ordinal: 435800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: /wiki/ shows every wiki page so a reader can browse them. Listings are subjects in src/web/listing-subject.ts, routed by listingAt in src/web/paths.ts; tag archives are the nearest example. A wiki index is short enough to sit on one page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `/<wiki_base>/` lists every published wiki page A to Z by title, grouped by first letter, with no pagination
- [x] #2 It is served in HTML, .md, .gmi and .json, drawn by a new `wiki-index` layout and its Markdown and Gemini templates in the default theme
- [x] #3 With no published wiki pages it is a 404
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: add ArchiveReader.listWiki() (published, untrashed, listed wiki pages) in the sqlite archive reader.
2. Routing: classifyPath answers /<wiki_base>/ with a new PathMatch kind 'wiki-index' only while a listed wiki page exists (else 404); no page segments are parsed under the wiki base, so /wiki/page/ stays a wiki page slug and /wiki/page/2/ is a 404. canonicalHref, the representation-extension loop in resolveRequest, serve() and the Markdown link rewriter learn the new kind.
3. A wiki-index module: sort pages A to Z by label (localeCompare), group by first letter (accents folded, non-letters under '#'); serve HTML via a new renderer.renderWikiIndex, Markdown and Gemini via wikiIndexMarkdown (chrome carries wikiGroups for the text layout), JSON as the listing's array of documentJson in A to Z order; ETag/Last-Modified like a listing.
4. Default theme: layouts/wiki-index.njk, wiki-index.md.njk, wiki-index.gmi.njk; TEMPLATES.wikiIndex.
5. Tests first in src/web/wiki-index.test.ts: order/grouping, no pagination, the four representations, 404 with none (drafts/trashed only), /wiki/page/ as a wiki page, /wiki/page/2/ and /wiki/feed/ 404, base change.
6. Docs: theme layout tables (docs/theme/markdown.md, gemini.md, themes.md) list wiki-index; full docs left to TASK-536.
7. Run build, test, test:11ty, typecheck, lint, format:check; curl a running server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. /<wiki_base>/ is a PathMatch of its own ('wiki-index') rather than a ListingSubject, because a listing subject brings a feed and page/N/ segments the index must not have; so /wiki/page/ stays the wiki page called page, and /wiki/page/2/ and /wiki/feed/ are 404s. store.listWiki() is a new ArchiveReader query (type wiki, LISTED_CLAUSE). Grouping (src/web/wiki-index.ts): sorted with localeCompare (base sensitivity, numeric), letter = first code point after NFD, upper-cased; non-letters under '#', which sorts first. HTML via renderer.renderWikiIndex with a wikiGroups context; Markdown/Gemini via wikiIndexMarkdown, MarkdownChrome.wikiGroups feeds the text layouts; JSON is the listing shape (array of documentJson) in A to Z order. Markdown link rewriting treats the index like a listing, so [x](/wiki/) becomes /wiki/index.md. Not done here (left for TASK-536 or later): docs for the layout and the layout-template tables; the sitemap does not list /wiki/; a former wiki base's index (/notes/) does not 301 to the new one, only its pages do.
Verification: src/web/wiki-index.test.ts (9 tests); pnpm build, test, test:11ty, typecheck, lint, format:check all exit 0. Curl against a scratch server on port 3057: /wiki/, index.md, index.gmi, index.json all 200 with grouped A-Z output; /wiki/page/2/ and /wiki/feed/ 404; with the wiki folder removed all four are 404.

Follow-up gaps closed: a former wiki base's index (/notes/ and its index.md/.gmi/.json) now 301s to the current base's index while the index exists, and 404s when it does not (formerWikiHref in routes.ts); the sitemap lists /<wiki_base>/ while a wiki page is listed, dated by the newest one; the index kicker reads Wiki. Four new tests in wiki-index.test.ts; build, test, test:11ty, typecheck, lint and format:check exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the wiki index at /<wiki_base>/: every published wiki page A to Z by title, grouped by first letter (accents folded, digits and symbols under #), on one page with no pagination or feed, in HTML, .md, .gmi and .json. It is a 404 while no published wiki page exists. New default-theme layouts wiki-index.njk, wiki-index.md.njk and wiki-index.gmi.njk; new store query listWiki(); routing via a new 'wiki-index' path match so /<base>/page/ remains a wiki page slug. Tests in src/web/wiki-index.test.ts; full check chain green and curl-verified. Follow-ups: docs (TASK-536), sitemap entry for the index, 301 for a former base's index.
<!-- SECTION:FINAL_SUMMARY:END -->
