---
id: TASK-343
title: A page can have no title
status: To Do
assignee: []
created_date: '2026-10-11 13:29'
labels:
  - content
  - themes
dependencies: []
priority: medium
type: enhancement
ordinal: 302800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page must have a title today. The parser refuses a page file without one (`requiredString` for pages in packages/cms/src/content/parser.ts), so the file is never indexed, and the editor refuses to save one ("A page needs a title.", packages/cms/src/admin/documents.ts). A static homepage or a landing page often has no heading of its own, and the default theme already prints the front page h2 only when there is a title (front-page.njk), but a page can never get there.

Andrew, 2026-10-11: titles should be optional for pages, as they already are for posts (a post with no title is a note).

Every place that names a page needs a fallback when it has none: the HTML <title> (the site title, as a homepage), the page layout h1 (left out), JSON-LD and Open Graph names, admin lists and pickers, navigation menu items that point at a page, search results, llms.txt, the sitemap, backlinks and citations (postLabel), the Markdown and JSON representations, and the Eleventy example. Decide the fallback once and use it everywhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A page file with no title parses and is served; a page with an empty or missing title is no longer an error
- [ ] #2 The editor saves a page with no title, and Micropub can create one
- [ ] #3 The default theme prints no h1 for an untitled page and no h2 for an untitled static front page; the HTML <title> falls back to the site title
- [ ] #4 Every place that names a page (admin lists and pickers, menus, search, JSON-LD, Open Graph, llms.txt, backlinks, citations, representations) has one documented fallback for an untitled page, and none prints an empty name
- [ ] #5 The Eleventy example builds an untitled page
- [ ] #6 docs/content.md and the theme docs describe untitled pages
<!-- AC:END -->
