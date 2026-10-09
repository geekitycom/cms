---
id: decision-38
title: >-
  The WordPress content import owns a file only while it holds what the import
  last wrote
date: '2026-10-09 17:05'
status: proposed
---
## Context

TASK-291 makes `geekity import wordpress <export.xml>` rerunnable. A site
imports early, checks the result, imports again just before the cutover, and
once more after it to catch what WordPress received in between. Meanwhile the
operator and a site overlay script edit imported files, and the live site
writes files of its own. The import must converge on the same files every run,
pick up what changed on WordPress, and never overwrite or delete a file it did
not write (TASK-291 #2, #3, #10).

A file carries nothing that says who wrote it, and a marker in front matter
would be one more key every editor must keep. The modification time changes
on a copy or a checkout. The bytes are the only reliable record of what the
import left.

## Decision

- **The import keeps a record of what it wrote.** `import.json` in the plugin's
  data folder (`data/plugins/@geekity/plugin-wordpress/`) maps each
  content-relative path to the SHA-256 of the bytes the import last wrote
  there. Nothing goes in the content directory but the imported files.
- **Each file is decided by three hashes**: what is on disk, what the record
  says, and what the import would write now.
  - The disk already holds the new bytes: unchanged. An unrecorded file is
    adopted into the record, so a run that stopped between a write and its
    record converges on the next run.
  - Nothing is on disk: written, whether or not the record has the path.
    Removing a file and running again is how an operator takes WordPress's
    side of a conflict.
  - The disk holds what the import last wrote: written, because WordPress
    changed the item.
  - The path is not in the record: a clash. The file is the site's own and is
    left alone.
  - Otherwise the file was edited on this site. It is kept. When WordPress
    changed the item too, the report calls it a conflict and gives the file's
    modification time and the item's `post_modified_gmt`.
- **The import never deletes.** An item removed from WordPress leaves its file
  in place.
- **Writes are atomic** (a `.tmp` sibling renamed over the target), so the
  watcher of a running site sees a whole file or none. The record is updated
  after each write.
- **One importer per kind of content, one owner per path.** An importer claims
  post types and turns the whole parsed export into files and notes. Two
  importers writing one path is an error. An item whose post type no importer
  claims is skipped and counted; a table names the types with no Geekity
  counterpart and why.
- **Core's part is one field.** `PluginSite.contentDir` gives a plugin the
  content directory (decision-33). Core names no WordPress.

## Consequences

- Losing `import.json` turns every imported file into a clash on the next run.
  The operator deletes the files to import them afresh, or restores the
  record.
- A file shared with the site, such as a post's comment file that the live site
  also appends to, cannot be owned whole. TASK-291.3 merges into it by
  WordPress comment id instead, and needs a merge write beside the whole-file
  one.
- The record lives in `data/`, beside the other plugin state. A site that
  moves its content directory without `data/` loses it, with the consequence
  above.
