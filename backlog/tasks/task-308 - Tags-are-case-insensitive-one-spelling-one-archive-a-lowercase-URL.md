---
id: TASK-308
title: 'Tags are case-insensitive: one spelling, one archive, a lowercase URL'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 02:03'
updated_date: '2026-10-09 03:16'
labels: []
dependencies: []
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/web/taxonomy.ts
  - packages/cms/src/admin/taxonomy.ts
documentation:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
priority: medium
type: enhancement
ordinal: 268800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tags are case-sensitive today: front matter keeps the spelling as typed, the index groups on the exact text, and the archive URL is the tag as written, so WordPress and wordpress are two tags with two archives, and on shll.me /tag/introductions/ answers 200 while /tag/Introductions/ is a 404. Andrew decided on 2026-10-09 to keep readable CamelCase spellings (fediverse practice and screen readers favour #WordCampUS) but treat tags case-insensitively. Files keep their spelling, so an Eleventy build of the same folder still works.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The index, tag counts, the tag list, tag archives, feeds by tag and search by tag treat tags case-insensitively: WordPress and wordpress are one tag with one count and one archive holding both posts
- [x] #2 A tag's displayed spelling is one spelling chosen consistently (the most used, ties broken by the earliest use) everywhere the site shows the tag, including archive titles, post tag links, the admin tag screens and ActivityPub hashtags
- [x] #3 A tag archive lives at the lowercase URL (/tag/wordcampus/), and any other casing of the path answers 301 there; pagination and feed URLs under it follow the same rule
- [x] #4 Saving from the editor or Micropub reuses the site's existing spelling for a tag that matches one ignoring case, and the editor says when it did; the tag rename screen renames every casing of a tag at once
- [x] #5 Plugins see one entry per tag (siteTags, listTags) in the site's spelling, so Tag suggest keeps matching as it does now
- [x] #6 Tests cover mixed-case tags across documents for counts, archives, the redirect, feeds and the editor reuse; doc-2 says tags are matched without regard to case and how a static Eleventy build differs when files disagree on case
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a tag's identity is its key, tag.toLowerCase() (locale-independent, no Unicode normalisation; SQLite's lower() folds ASCII only, so the key is computed in JS and stored). Files keep their spelling; the index stores spelling and key; the site's spelling of each key is derived from the rows, so a rebuild answers the same (decision-9).
1. content/tags.ts: tagKey, uniqueTags (first spelling wins), respellTags. Parser dedupes tags by key.
2. Store migration 8: document_tags gains key, PRIMARY KEY (path, key), index on key; documents emptied so the next scan refills it. One SQL query ranks spellings per key (most listed uses, earliest listed use, then most uses anywhere, earliest, then the text); the store keeps the result in memory and refreshes only keys a write touched, all of it when PRAGMA data_version shows another connection wrote or the clock reaches the next scheduled document. Hydrated documents, listTags, listTermUsage('tag') and tagSpelling(tag, {excluding}) read it; listByTag, countByTag and listAll({tag}) match on key.
3. web/taxonomy.ts: termKey; termHref puts a tag archive at its key; redirectedTerm, recordTermRename, forgetTerm and taxonomyRedirectsOf compare tags by key. Default theme tag links use tag | lower | urlencode.
4. web/routes.ts: a tag archive request carries the site's spelling; another casing of an archive, page or feed answers 301 to the lowercase URL while the tag exists.
5. ActivityPub hashtags spell tags through the store (delivery may hold a file just read); notify dedupes terms by key.
6. writeDocument (editor and Micropub) respells tags to the site's spelling, excluding the document being saved; the editor flashes which. Rename/merge/delete reach every casing; a case-only rename is a rename, not a merge, and records no redirect.
7. Categories stay case-sensitive.
8. Tests, doc-2, full verification, test:11ty, curl a scratch site, Tag suggest tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- Key is toLowerCase(): locale-independent and identical to Nunjucks' lower filter, which the theme uses for links. No NFC/NFD normalisation (documented in doc-2).
- Categories unchanged: same SQL helpers, but TERM_TABLES gives tags a key column and categories their exact text. The task and Andrew's decision are about tags; category URLs keep their spelling.
- Document.tags read from the index carry the site's spelling; parsed documents (saveDocument, sync) keep the file's, so the activitypub.published stamp and rename rewrites never put another file's spelling into a file mid-rename. An earlier try that announced indexed documents did exactly that: the stamp rewrote one file to the old majority spelling while a case-only rename was running. Reverted.
- First version computed the spelling per tag in a correlated subquery: measured on 3,000 posts x 5 tags (500 tags, skewed), listPosts(10) 2.4 ms vs 0.13 ms and the sitemap loop 4.3 s vs 0.15 s. Now one pass, kept in memory with exact invalidation: listPosts 0.14 ms, listTags 8.0 ms (8.1 before), sitemap 165 ms (143 before), write then list 1.1 ms (0.8 before), hydrate+rewrite every document 3.6 s (2.1 s before). A store test mutation-checks each invalidation path.
- Platform-name boundary test forbids the word in core code, so core tests use OpenSource as the mixed-case tag.
Validation: pnpm build, test (cms 5030 pass, all packages 0 fail), typecheck, lint, format:check, test:11ty (18 + 8 pass). Scratch site via dist createCms on :3917: /tag/introductions/ 200; /tag/Introductions/ 301 -> /tag/introductions/; /tag/INTRODUCTIONS/page/2/ 301 -> /tag/introductions/page/2/; /tag/Introductions/feed/ 301 -> /tag/introductions/feed/; /tag/IndieWeb/feed/atom/ 301 -> /tag/indieweb/feed/atom/; /tag/Nothing/ 404; RSS feed carries 4 items each <category>introductions</category> (the template post plus one other used the lowercase spelling first, so the earliest-use tie-break picked it) and IndieWeb x3; post links /tag/indieweb/ as IndieWeb. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tags now match without regard to case. The index stores each tag's lowercase key (migration 8 empties the index so the next scan refills it); counts, the tag list, archives, feeds, admin filters and plugin siteTags group on the key. One spelling per tag, the one most listed documents use with ties to the earliest, is shown on archive titles, post tag links, feed categories, ActivityPub hashtags, the admin tag screens and Micropub q=category. Tag archives live at /tag/{lowercase}/ and any other casing of an archive, its pages or its feeds answers 301 there. The editor and Micropub write the site's spelling for a tag that matches one ignoring case and the editor says so; rename, merge and delete reach every casing, and a case-only rename rewrites without recording a redirect. Categories are unchanged. doc-2 has a Tags section, including how an Eleventy build differs. Verified with new tests in store, taxonomy, tag-case routes, admin taxonomy, editor, Micropub, editor actions and ActivityPub (each seen failing first), the full pnpm build/test/typecheck/lint/format:check, test:11ty, a benchmark at parity on reads, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
