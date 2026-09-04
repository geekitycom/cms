---
id: TASK-35
title: 'Categories: a second taxonomy alongside tags'
status: To Do
assignee: []
created_date: '2026-09-04 00:31'
labels:
  - content
  - admin
  - theme
milestone: m-5
dependencies:
  - TASK-3
  - TASK-5
  - TASK-6
  - TASK-11
references:
  - backlog/docs/doc-2 - Content-Format-(11ty-compatible-Markdown).md
  - 'https://andrewshell.org/category/general/'
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress posts carry categories as well as tags, and https://andrewshell.org/ (the site this CMS is to replace) files every post under one or more categories with archives at `/category/{slug}/`. Add `categories` as a front-matter array on posts, parsed, indexed and written like `tags` (an Eleventy build sees it as an ordinary data key). The index gains a categories table and the store gains list-by-category, counts and paging exactly as tags have. The public site gains a category archive with the same paging as the tag archive, the theme a category layout (or one taxonomy layout for both), the editor a categories field next to tags, the JSON representation and the document context the new array, and the ActivityStreams Article a Hashtag per category the same way tags produce them. Category slugs derive from the name the way tag slugs do. Archive paths use the fixed `category` base in this task; the configurable bases arrive in the next one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post with categories in its front matter round-trips through parse, index and write unchanged, and a post without the key still works
- [ ] #2 /category/{slug}/ lists that category's published posts newest first with paging and a 404 for an unknown category
- [ ] #3 The post editor saves categories and shows them on reload; the posts list and the post page show them with links to the archive
- [ ] #4 The .json representation, the document context and the Article's tags include categories
- [ ] #5 Drafts and trashed posts never appear in a category archive
- [ ] #6 The packaged Eleventy example config exposes a categories collection and test/eleventy.test.ts proves it
<!-- AC:END -->
