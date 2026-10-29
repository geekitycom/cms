---
title: Content directory
description: The folder that holds every post, page and wiki page as a Markdown file.
updated: '2026-10-29T15:00:00Z'
---

`content/` holds what the site publishes:

- `posts/` for dated posts
- `pages/` for standing pages
- `wiki/` for these wiki pages
- `uploads/` for images and other files

Each document is a Markdown file with [[front matter]]. The database is an
index of these files and can be deleted. The next boot builds it again.

A wiki link names a page by its title, as in `[[Permalinks]]`, and is written
in the file as two square brackets. The page it names does not have to exist
yet: [[Representations]] has no page here, so the link answers 404 until
someone writes one.
