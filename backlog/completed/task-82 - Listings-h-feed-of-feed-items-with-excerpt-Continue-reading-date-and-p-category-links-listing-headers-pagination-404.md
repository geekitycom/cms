---
id: TASK-82
title: >-
  Listings: h-feed of feed items with excerpt, Continue reading, date and
  p-category links; listing headers; pagination; 404
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:37'
updated_date: '2026-09-13 18:10'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-81
  - TASK-86
references:
  - packages/cms/themes/default/partials/post-list.njk
  - packages/cms/themes/default/partials/pagination.njk
  - packages/cms/themes/default/layouts/home.njk
  - packages/cms/themes/default/layouts/author.njk
  - /Users/andrewshell/code/wordpress/asdo-theme/template-parts/feeditem.php
  - /Users/andrewshell/code/wordpress/asdo-theme/index.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 107800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the post list with the source design feed (decision-16). partials/post-list.njk becomes a div.feed.h-feed of article.feed-item.h-entry items separated by hr.feed-separator: a heading (h2 on a listing, h3 on the front page, chosen by a heading level the including layout sets) with class feed-title p-name wrapping a u-url link, div.feed-excerpt.p-summary printing the entry summary (TASK-79) truncated to about 280 characters at a word boundary, p.feed-more with a Continue reading link carrying an aria-label naming the entry, and div.feed-meta with time.feed-date.dt-published and p.post-categories of p-category links with rel="category" for the categories; tags are not printed in a feed item. The listing layouts (home, posts page, tag, category, author) print an h1 of the listing name, the category archive its description when the taxonomy has one, and the author archive its header h-card as now with the bio classes. The entry count line is dropped. Pagination prints previous and next as arrows with the words Previous and Next, in a nav, and nothing on one page. The 404 says Content not found with links home and, once search exists, to search. The empty listing says No posts found.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A listing renders .feed.h-feed of .feed-item.h-entry items with .feed-title.p-name > a.u-url, .feed-excerpt.p-summary, .feed-more, .feed-meta time.dt-published and .post-categories a.p-category[rel=category], separated by hr.feed-separator, with the heading level the layout sets
- [x] #2 The excerpt is the entry summary cut to about 280 characters at a word boundary with an ellipsis, HTML-free, and a post with a description prints that description whole when it is shorter
- [x] #3 Home, posts page, tag, category and author listings print their h1, the category description when present, and no entry count; the author archive header keeps its h-card, u-photo, p-name, p-note and rel="me" u-url links
- [x] #4 Pagination renders previous and next links with rel prev and next and arrow text, nothing on one page; the 404 prints Content not found with a home link
- [x] #5 site.test.ts, front-page.test.ts, author-archive.test.ts and the demo site test are updated and pass; the stylesheet gains the feed, feed-meta, post-categories, category-header, blog-post-nav and pagination rules from the source
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write failing tests first, in a new `packages/cms/src/web/listings.test.ts` over HTTP against the packaged theme (the page-shell.test.ts pattern): the h-feed markup and its separators, the heading level a layout sets, the 280-character word-boundary excerpt, a short description printed whole, the listing headers without an entry count, the author archive's h-card, pagination's rel prev/next arrows and its absence on one page, the empty listing and the 404.
2. partials/post-list.njk becomes div.feed.h-feed of article.feed-item.h-entry with div.feed-content: hN.feed-title.p-name > a.u-url, div.feed-excerpt.p-summary of the summary through Nunjucks' own `truncate(280)` (which cuts at the last space and appends an ellipsis, the same rule as the source's asdo_truncate), p.feed-more with the Continue reading link and its aria-label, and div.feed-meta of time.feed-date.dt-published plus the categories. Separated by hr.feed-separator, heading level from `feedHeading` defaulting to 2. No tags in a feed item.
3. partials/tags.njk: the `categories` macro becomes the source's p.post-categories of a.p-category[rel=category]. `list(tags)` is left alone until TASK-83 rewrites the entry footer.
4. partials/pagination.njk: nav.pagination of the two arrow links only, rel=prev/next, no position line, nothing on one page.
5. Layouts: home/tag/author drop the entry count; category gains header.category-header with an optional div.category-description; 404 says Content not found with a link home and a comment about the search link TASK-22 will add. The empty listing says No posts found.
6. Stylesheet: replace the old .post-list*, .post-summary*, .tag-count rules with the source's .feed-title, .feed-separator, .feed-meta, .feed-meta p, .post-categories, .category-header and .category-description; keep .tag-list/.tag/.post-meta until TASK-83 stops using them. No new colour tokens, so theme-colors.test.ts is untouched.
7. Update the tests that assert the old markup: site.test.ts, theme-choice.test.ts, packages/cms/test/eleventy.test.ts and apps/demo/test/site.test.ts, and the theme README's file list, page shell and taxonomy macro sections.
8. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus curl against a booted demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**What was built.** `partials/post-list.njk` is now the source design's feed: `div.feed.h-feed` of `article.feed-item.h-entry` (each wrapping a `div.feed-content`) separated by `hr.feed-separator`, with `hN.feed-title.p-name` > `a.u-url`, `div.feed-excerpt.p-summary`, `p.feed-more` carrying the aria-labelled Continue reading link, and `div.feed-meta` of `time.feed-date.dt-published` plus the categories. Tags are not printed in a feed item. The heading level is `feedHeading`, defaulting to 2; a layout sets it before including the partial and Nunjucks carries the frame variable into the include, which the test with a fixture theme setting 3 proves.

**The excerpt** is the entry's `summary` (TASK-79) through Nunjucks' own `truncate(280)`. That filter cuts at the last space before the length and appends an ellipsis, which is exactly what the source theme's `asdo_truncate` does, so no filter was added to the environment's semver contract.

**The categories macro** in `partials/tags.njk` now renders the design's `p.post-categories` of `a.p-category[rel=category]` instead of a `ul.category-list`. It is the shape the design prints both in a feed item's meta line and under an entry, so `layouts/post.njk` and the demo theme's post override pick it up too. `list(tags)` is untouched until TASK-83 rewrites the entry footer.

**Pagination** is two arrows in `nav.pagination` with `rel="prev"`/`rel="next"`, the arrows `aria-hidden`; the "Page n of m" line is gone, as is the entry count on every listing. The 404 says "Content not found." and links home, with a comment where the search link goes once TASK-22 exists.

**Category descriptions: the CMS has no store of them.** `src/web/taxonomy.ts` is only about archive bases and redirects, and `src/admin/taxonomy.ts` has no `description` anywhere — TASK-48's taxonomy management renames and merges terms but does not describe them. So `layouts/category.njk` prints `header.category-header` with the heading, and `div.category-description` only when the context carries a `categoryDescription`. Nothing writes one today; the branch is proved by rendering the packaged layout directly over a context that has one, and the notes say so rather than inventing a store.

**The author archive header** is left as it was — `header.author-header.h-card` with `u-photo`, `p-name`, `p-note` and `rel="me" u-url` links — because TASK-83 introduces `partials/bio.njk` and will own that h-card and the bio classes. Only the entry count under it was dropped.

**The demo theme's stylesheet had to move with the markup.** `apps/demo/themes/demo/static/style.css` is an all-or-nothing override of `/theme/style.css`, so the demo site would have served the new feed unstyled. Its listing rules were rewritten onto the new class names in the demo's own idiom (not a copy of the packaged design) and `.pagination-position` was dropped.

**Not changed:** `packages/cms/test/eleventy.test.ts` asserts the Eleventy *fixture's* own `ul.post-list` layout under `test/fixtures/content/_includes/`, which is not the packaged theme; it was left alone and passes. `front-page.test.ts` and `author-archive.test.ts` assert text rather than listing markup and needed no edit.

**Verified:** `pnpm build && pnpm test` (1809 + 27 pass, 0 fail), `pnpm test:11ty` (16 + 5 pass), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all clean. The demo was booted on port 3399 and curled: the home feed and its separator, page 2's two arrows, `/category/general/`'s `header.category-header`, `/tag/content/`, the 404, and `/theme/style.css` carrying the rewritten rules. The server was stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme's listings are the andrewshell.org feed (decision-16). `partials/post-list.njk` prints a `div.feed.h-feed` of `article.feed-item.h-entry` separated by `hr.feed-separator`, each with a linked `feed-title.p-name` at the heading level the layout sets through `feedHeading`, a `feed-excerpt.p-summary` of the entry summary cut at a word boundary near 280 characters, an aria-labelled Continue reading link, and a `feed-meta` of `dt-published` and `p-category` links; tags stay off a feed item. The listing layouts print their h1 and no entry count, the category archive gets a `category-header`, pagination is two arrows with rel prev/next and nothing on one page, and the 404 says Content not found with a link home. The stylesheet gains the source's feed, feed-meta, post-categories, category-header, category-description, blog-post-nav and pagination rules and loses the old post-list ones, and the demo theme's override moved with it. Verified by a new `src/web/listings.test.ts` of 13 HTTP tests against the packaged theme, by the updated site, theme-choice and demo site tests, and by curling a booted demo; `pnpm build`, `test`, `test:11ty`, `typecheck`, `lint` and `format:check` are all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
