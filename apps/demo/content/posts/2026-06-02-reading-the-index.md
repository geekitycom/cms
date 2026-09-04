---
title: Reading the index
date: '2026-06-02T12:30:00Z'
permalink: /reading-the-index/
tags:
  - sqlite
categories:
  - engineering
description: A post that keeps a flat URL, because a permalink in the front matter always wins.
author: Andrew Shell
---

Posts are filed under `/{yyyy}/{mm}/{slug}/` unless the file says otherwise.
This one says otherwise: its front matter carries

```yaml
permalink: /reading-the-index/
```

and that is the address it is served at, indexed at, and linked from. The
default is a default, not a rule, and the same is true under Eleventy — the
example config only fills a permalink in when the file has none.

## Why bother

Some posts are references rather than dispatches. A page you expect to link to
for years reads better without a year in it, and moving it later means either
a redirect or a broken link, so the moment to decide is now.

The trade is that nothing stops two flat permalinks from colliding. The index
has a unique constraint on the column, so the second file to claim an address
is rejected by name rather than quietly shadowing the first.
