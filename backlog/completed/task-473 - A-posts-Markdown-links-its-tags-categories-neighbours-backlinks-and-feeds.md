---
id: TASK-473
title: 'A post''s Markdown links its tags, categories, neighbours, backlinks and feeds'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 00:08'
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
ordinal: 398800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post's Markdown lists tags and categories only as bare names in front matter, has previous/next only in front matter, and prints none of the 'Linked from' backlinks or feed links the HTML shows. A Markdown reader can't follow any of them. The footer should print them as links, using the same data the HTML partials (tags.njk, backlinks.njk, feeds.njk, the post neighbours) use, and expose it in the Markdown partial context so a theme can lay it out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post's Markdown footer lists its tags and categories as links to their archives' .md URLs
- [x] #2 A post's Markdown has previous and next post links in its body, not only in front matter
- [x] #3 A post or page with backlinks lists them under a Linked from heading, as the HTML does
- [x] #4 Posts, pages, tag, category and author listings list the feeds the HTML head advertises for them (site, archive, comments) as links
- [x] #5 The new data is on the Markdown partial context and documented in docs/theme/markdown.md; tests cover each list
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in packages/cms/src/web/markdown-representation.test.ts: a post with tags and categories, a post and a page linked from other posts, neighbours in the body, and the feed lists of a post, a page, the home listing, a tag, a category and an author archive; plus a site-theme test that reads every new key off the partial context.
2. MarkdownChrome gains type ('post' | 'page' | 'listing') and feeds (MarkdownFeed: label, url, format, type). markdown-representation.ts builds feeds the way base.njk and the tag/category/author layouts advertise them: site RSS/Atom/JSON, the site comments feed, a served document's own comments feed, and an archive's three feeds.
3. renderMarkdownChrome adds, from the document option, taxonomy (a post's categories then tags as links to their archives via termHref and the site's bases) and backlinks (the renderer's backlinks source, as dated entries).
4. The default markdown-footer.md.njk prints, after the archive: Filed under (categories, tags), Linked from (backlinks), a post's More posts (Previous/Next), Feeds, then the site heading/byline/menus. A listing keeps its pager in the CMS block, so the footer prints neighbours only when type is post.
5. Document the new keys and the footer layout in docs/theme/markdown.md and the footer row in docs/public-site.md.
6. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; curl the scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Feeds are built in markdown-representation.ts (siteFeeds + a served document's comments feed, or an archive's three feeds when they are not the site's), in base.njk's head order; categories, tags and backlinks are added by renderMarkdownChrome from the document option, beside archiveMonths.
- New partial keys: type, categories, tags, backlinks, feeds. Listings keep their pager in the CMS block, so the default footer prints previous/next only when type is post (More posts: Previous:/Next:).
- Found while testing: the front page's Markdown was built from a copy whose permalink was '/', so its comments feed came out as /feed/ (the posts feed). documentMarkdown now takes the stored document and the served URL; the front matter still says permalink: /.
- The default front-page layout prints no backlinks, so the default footer leaves Linked from off a static homepage (staticFrontPage), as the header does with the bio; the context still carries backlinks.
- Updated exact-output tests that the new footer sections change: negotiation, author-archive, front-page (TASK-345 check now allows /welcome/feed/, which the HTML head advertises) and the admin-bar anonymous golden (regenerated with GEEKITY_UPDATE_GOLDEN=1; only the post markdown body and ETag changed).
- Scratch site (port 3472): on a post, a tag, two categories, the static homepage, /posts/, /archive/ and /colophon/, the Markdown Feeds URLs equal the HTML head's rss/atom/feed+json link hrefs in order; with a page added linking to a post, the post's HTML and Markdown both list it under Linked from; tag and category .md links answer 200 text/markdown. Server stopped and the added page removed.

Validation: pnpm build, typecheck, lint, format:check, test (cms 6561 pass) and test:11ty all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post's or listing's Markdown footer now links what its HTML links beyond the body: a post's categories and tags (Filed under, to each archive's .md), the site's posts and pages that link to it (Linked from, dated lines), a post's previous and next (More posts), and the feeds the HTML head advertises (Feeds: site RSS/Atom/JSON, site comments, a document's comments feed, an archive's three feeds). The data is on the partial context as type, categories, tags, backlinks and feeds, documented in docs/theme/markdown.md and docs/public-site.md. Also fixed the front page's Markdown being built from a copy with permalink '/', which pointed its comments feed at /feed/. Verified by new tests in markdown-representation.test.ts (each list, parity with the HTML head's feed links and the HTML backlinks on posts, pages, home, tag, category, author and a static homepage, and a site theme reading every key), the full check suite, and curl against the scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
