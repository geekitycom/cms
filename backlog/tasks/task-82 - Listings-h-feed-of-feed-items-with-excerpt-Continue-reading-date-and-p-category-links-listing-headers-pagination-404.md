---
id: TASK-82
title: >-
  Listings: h-feed of feed items with excerpt, Continue reading, date and
  p-category links; listing headers; pagination; 404
status: To Do
assignee: []
created_date: '2026-09-13 13:37'
updated_date: '2026-09-13 14:36'
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
- [ ] #1 A listing renders .feed.h-feed of .feed-item.h-entry items with .feed-title.p-name > a.u-url, .feed-excerpt.p-summary, .feed-more, .feed-meta time.dt-published and .post-categories a.p-category[rel=category], separated by hr.feed-separator, with the heading level the layout sets
- [ ] #2 The excerpt is the entry summary cut to about 280 characters at a word boundary with an ellipsis, HTML-free, and a post with a description prints that description whole when it is shorter
- [ ] #3 Home, posts page, tag, category and author listings print their h1, the category description when present, and no entry count; the author archive header keeps its h-card, u-photo, p-name, p-note and rel="me" u-url links
- [ ] #4 Pagination renders previous and next links with rel prev and next and arrow text, nothing on one page; the 404 prints Content not found with a home link
- [ ] #5 site.test.ts, front-page.test.ts, author-archive.test.ts and the demo site test are updated and pass; the stylesheet gains the feed, feed-meta, post-categories, category-header, blog-post-nav and pagination rules from the source
<!-- AC:END -->
