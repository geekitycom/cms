---
title: Hello, world
date: '2026-01-01T09:00:00Z'
permalink: /2026/01/hello-world/
tags:
  - introductions
description: The first post of a new Geekity site, and where to go from here.
---

This post is the file `content/posts/2026-01-01-hello-world.md`. The files are
the source of truth; the SQLite index under `data/` is derived from them, so
deleting it is safe and the next boot rebuilds it.

## Where things are

- `content/posts/` and `content/pages/` hold the documents. Everything else in
  `content/` is left alone.
- `content/_data/site.json` is the site title, tagline, author and how many
  posts a listing page holds. It is the `site` global in every template.
- `themes/` does not exist yet. A theme is a directory in there with a
  `theme.json` in it, overriding one template at a time; anything it does not
  override still comes from the package. `theme` in `site.json` says which one
  the site wears, and no theme at all is the one the package ships.
- `geekity.config.ts` is the port, the directories and the public base URL.

## Two things to try

Add a tag to the front matter above and reload `/tag/introductions/`. Then ask
this page for its other representations:

```sh
curl -H 'Accept: text/markdown' http://localhost:3000/2026/01/hello-world/
curl http://localhost:3000/2026/01/hello-world/index.json
```

Same URL, three bodies.
