---
title: Front matter
description: The YAML block at the top of every document, and which keys the CMS reads.
updated: '2026-10-29T15:00:00Z'
---

Every document starts with a block of YAML between two `---` lines. The CMS
reads the keys it models, such as `title`, `date` and `tags`, and keeps every
other key through a save.

A wiki page reads fewer keys than a post. It has no `date`, no `tags` and no
`permalink`, because its address comes from its file name. See
[[Permalinks#Wiki pages|how a wiki page gets its URL]].

The files live in the [[content directory]], and the index is rebuilt from
them on every boot.
