---
id: TASK-468
title: The archive page's Markdown lists its posts
status: To Do
assignee: []
created_date: '2026-10-21 17:16'
updated_date: '2026-10-21 17:57'
labels: []
milestone: m-43
dependencies: []
priority: medium
ordinal: 402800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page with archive: true lists every published post by month in its HTML, from archiveMonths. Its Markdown representation (index.md, or Accept: text/markdown) has only the page's front matter, its own body and the theme's header and footer, so the posts are missing. The Markdown context has no archiveMonths, so a site theme can't add them either. A Markdown browser or a language model that follows the archive link in the menus finds an empty page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Markdown of an archive: true page lists every published post under the page's own Markdown, grouped by month, newest first, matching the HTML
- [ ] #2 Each post is one line, in the shape a listing's Markdown already uses: [date title](url.md): description
- [ ] #3 The Markdown header and footer partials get archiveMonths, so a theme can override the layout
- [ ] #4 docs/public-site.md and docs/theme/markdown.md describe the archive page's Markdown
<!-- AC:END -->
