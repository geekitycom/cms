---
title: Six tables and a migration
date: '2026-07-11T21:20:00Z'
updated: '2026-07-19T14:00:00Z'
permalink: /2026/07/six-tables-and-a-migration/
tags:
  - sqlite
  - content
categories:
  - engineering
description: What the derived index actually stores, and why deleting it is safe.
author: Andrew Shell
activitypub:
  published: '2026-07-11T21:20:00Z'
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

A migration is a version and the statements that take the schema to it, so the
list in the code is the history:

```typescript
const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: 'create table documents (...);' },
  { version: 2, sql: 'create table document_categories (...);' },
];
```

Nothing that has shipped is ever edited — a site that upgrades has to land on
the same schema as a site that starts today — so a change is always an
appended version:

```diff
 const MIGRATIONS: readonly Migration[] = [
   { version: 1, sql: 'create table documents (...);' },
   { version: 2, sql: 'create table document_categories (...);' },
-];
+  { version: 3, sql: 'delete from documents;' },
+];
```

That last one empties the index rather than changing a column: the rendered
HTML in it was made by an older renderer, and the files it came from have not
changed, so the only way to get the new markup is to read them again.

Delete `data/geekity.db` and the next boot rebuilds every row from the files.
That is the test of whether the index is really derived, and it is worth
running now and then.

[^derived]: If deleting the database lost you anything, it was not an index.

[^offset]: A post published at 00:30 on 1 October in Berlin belongs to October,
    not to September, and sorting must not disagree with filing.
