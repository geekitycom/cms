---
title: Hello, World!
date: '2026-09-02T09:00:00-05:00'
permalink: /2026/09/hello-world/
tags:
  - introductions
  - eleventy
description: The first post on a file-first site.
author: andrew
---

Geekity is a file-first CMS.[^why] Content is Markdown on disk and the site is
one Node process.

## What it does

- Serves one URL as HTML, Markdown or ActivityStreams JSON.
- Writes files; the database is only an index.

```js
const cms = createCms({ baseUrl: 'https://example.com' });
await cms.serve();
```

<aside class="note">

Files win. Everything else is derived.

</aside>

[^why]: A database of record is a lock-in you cannot diff.
