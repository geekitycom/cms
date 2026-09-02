---
title: Six tables and a migration
date: '2026-07-11T16:20:00-05:00'
updated: '2026-07-19T09:00:00-05:00'
permalink: /2026/07/six-tables-and-a-migration/
tags:
  - sqlite
  - content
description: What the derived index actually stores, and why deleting it is safe.
author: Andrew Shell
---

The database is not the source of truth.[^derived] It answers the questions a
directory walk answers badly: the newest ten posts, everything carrying a tag,
whether a permalink is already taken.

## The shape of it

One row per document, plus the columns that make the listings cheap:

```sql
select permalink, title, date
from documents
where draft = 0 and trashed = 0
order by date_sort desc
limit 10;
```

`date_sort` is the same instant as `date`, normalised to UTC. `date` itself is
kept exactly as the file wrote it, offset and all, because that is what the
file says and a round trip has to give the bytes back.[^offset]

## Migrations

Schema changes are forward-only and run on boot, so upgrading the package is
the whole upgrade. Each one is recorded, so applying it twice does nothing:

```sql
create table if not exists migrations (
  version integer primary key,
  applied_at text not null
);
```

Delete `data/geekity.db` and the next boot rebuilds every row from the files.
That is the test of whether the index is really derived, and it is worth
running now and then.

[^derived]: If deleting the database lost you anything, it was not an index.

[^offset]: A post published at 00:30 on 1 October in Berlin belongs to October,
    not to September, and sorting must not disagree with filing.
