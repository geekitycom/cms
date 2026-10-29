---
title: Permalinks
description: Where each kind of document is served.
updated: '2026-10-29T15:00:00Z'
---

A post is served at `/{yyyy}/{mm}/{slug}/` and a page at `/{slug}/`. Both store
the URL in their [[front matter]], so a later change of setting does not move
them.

## Wiki pages

A wiki page is served at `/wiki/{slug}/`, where the slug is its file name in
the [[content directory]]. The URL is not stored. Change the wiki base on
Settings > Permalinks and every wiki page moves at once, with a 301 from the
old address.
