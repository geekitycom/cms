---
title: Colophon
permalink: /colophon/
description: What this site is built from, and where each piece lives.
---

This site is `apps/demo` in the Geekity CMS repository. It depends on
`@geekity/cms` through the workspace, the same way a site of your own would
depend on the published package.

## What is here

- `content/posts/` and `content/pages/` — six posts, one of them a draft, and
  three pages. Every one of them is a Markdown file with front matter.
- `content/_data/site.json` — the title, the tagline, the author, and how many
  posts a listing page holds.
- `theme/layouts/post.njk` and `theme/static/style.css` — the two files this
  site overrides. Everything else comes from the package.
- `eleventy.config.js` — the same content directory, built as a static site.

## Typography

Body copy is whatever serif your machine has: Iowan Old Style, then Palatino,
then Georgia. Nothing is downloaded, because the stylesheet has no build step
and no dependencies.
