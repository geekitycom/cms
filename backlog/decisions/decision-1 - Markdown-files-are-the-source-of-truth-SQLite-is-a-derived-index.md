---
id: decision-1
title: Markdown files are the source of truth; SQLite is a derived index
date: '2026-09-02 13:21'
status: accepted
---
## Context

The user wants to edit Markdown files directly and see the change on the live site, and wants the content to stay buildable by Eleventy. A CMS that owns its data in a database would either need export/import or would drift from the files.

## Decision

Markdown files under `content/` are the only source of truth for posts, pages, and site data. SQLite (`data/geekity.db`) holds a derived index rebuilt from the files on boot and kept current by a file watcher. The admin UI writes files, then updates the index. Only data with no natural file form (users, sessions, ActivityPub keys, followers, inbox log) is authoritative in SQLite.

## Consequences

- Deleting the database is safe; it is rebuilt on next boot. Users and federation state need a backup, so they get their own tables and an export command later.
- Conflicts resolve in favour of the file. The admin form carries a content hash and refuses to overwrite a file that changed underneath it.
- Queries that files cannot answer cheaply (lists by date, tag archives, later search) come from the index. Keeping the index schema small makes rebuilds fast.
- Eleventy can build the same directory at any time, which is the compatibility guarantee.
