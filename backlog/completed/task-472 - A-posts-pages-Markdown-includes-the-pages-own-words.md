---
id: TASK-472
title: A posts page's Markdown includes the page's own words
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-21 23:49'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
ordinal: 397800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With a postsPage set, the HTML listing at that page's permalink draws the page's own rendered body above the posts (home.njk, listing-subject.ts). Its Markdown (index.md or Accept: text/markdown) has only the title, the description quote and the post list: listingMarkdown never reads the page document, so the page's words are lost. Page 2 onward should behave as the HTML does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Markdown of the posts page prints the page's own Markdown body, with its site links pointing at .md, after the heading and description and before the post list
- [x] #2 Paginated pages of the posts page match the HTML: the body appears where the HTML shows it and not where it doesn't
- [x] #3 Tests cover the posts page Markdown, and docs/public-site.md describes it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in packages/cms/src/web/front-page.test.ts (a site with a posts page): /news/index.md prints the page body, with a site link rewritten to .md, after the heading and description quote and before ## Posts; /news/page/2/index.md carries the body too, as /news/page/2/ HTML does; the root listing of a site with no posts page prints no page body.
2. listingMarkdown reads archive.context.document and puts its normalized body, links rewritten against the page's permalink, between the description quote and the post list.
3. Describe it in docs/public-site.md (The Markdown, listing paragraph).
4. Run build, test, test:11ty, typecheck, lint, format:check; curl a scratch demo site with a posts page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
listingMarkdown now reads archive.context.document (the posts page, which listing-subject.ts already sets for the HTML) and prints its normalized body, links rewritten with markdownHrefFor against the page's own permalink, between the description quote and ## Posts. renderListing draws the body on every page of the posts page, so the Markdown does too; a root listing has no document and prints none.
Tests: front-page.test.ts 'prints the page's own words in its Markdown, as its HTML does' (page 1 order and .md link, page 2 HTML and Markdown) and 'has no page words in the Markdown of a root listing'. The first failed before the change.
docs/public-site.md: the listing paragraph under The Markdown describes the body. doc-3 (backlog doc) still lists the listing Markdown parts without the body; not changed here.
Validation: pnpm build, pnpm test (cms 6556 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Live: scratch copy of apps/demo/content served on :3472; curl /posts/index.md and Accept: text/markdown /posts/page/2/ both print the Posts page body after the quote and before ## Posts; server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A posts page's Markdown (index.md or Accept: text/markdown) now prints the page's own Markdown body after the heading and description and before the post list, on every page of the listing as the HTML does, with site links pointing at .md. Covered by two tests in front-page.test.ts and described in docs/public-site.md. Verified with the full build/test/typecheck/lint/format suite and curl against a scratch demo site.
<!-- SECTION:FINAL_SUMMARY:END -->
