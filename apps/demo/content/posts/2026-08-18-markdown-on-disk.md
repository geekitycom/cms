---
title: Markdown on disk
date: '2026-08-18T14:15:00Z'
permalink: /2026/08/markdown-on-disk/
tags:
  - content
categories:
  - general
  - engineering
description: Why the files are the source of truth and the database is only an index.
author: Andrew Shell
activitypub:
  id: http://localhost:3000/ap/posts/markdown-on-disk
  published: '2026-08-18T14:15:00Z'
---

Every post on this site is a file. `content/posts/2026-08-18-markdown-on-disk.md`
is what you are reading, front matter and all. Nothing is stored in a database
that cannot be rebuilt by reading the directory again.

## What that buys

- The content survives the software. Delete `data/geekity.db` and the next boot
  rebuilds it from the files.
- Edits are diffable. A one-word fix is a one-word diff, because the writer
  emits front matter in a fixed key order.
- Eleventy can build the same directory unchanged, so the escape hatch is a
  `git clone` and one config file rather than an export script.

## What the index is for

Questions a directory walk cannot answer cheaply: the newest ten posts, every
document carrying a tag, whether a permalink is already taken.

```js
store.listPosts({ limit: 10 });
store.listByTag('content');
store.getByPermalink('/2026/08/markdown-on-disk/');
```

Those all read SQLite. Every one of them is derived.
