---
id: TASK-473
title: 'A post''s Markdown links its tags, categories, neighbours, backlinks and feeds'
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
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
- [ ] #1 A post's Markdown footer lists its tags and categories as links to their archives' .md URLs
- [ ] #2 A post's Markdown has previous and next post links in its body, not only in front matter
- [ ] #3 A post or page with backlinks lists them under a Linked from heading, as the HTML does
- [ ] #4 Posts, pages, tag, category and author listings list the feeds the HTML head advertises for them (site, archive, comments) as links
- [ ] #5 The new data is on the Markdown partial context and documented in docs/theme/markdown.md; tests cover each list
<!-- AC:END -->
