---
id: decision-19
title: >-
  A reply's fetched context lives in content/_data/replyContexts.json, keyed by
  the URL it answers
date: '2026-09-23 19:29'
status: accepted
---
## Context

TASK-123 gives a reply a preview of the post it answers: that post's name or a short excerpt, its author and its date. The post is on somebody else's site, so the preview needs data fetched from there. A page request must never make that fetch. It happens when a reply is saved or synced, and what it finds has to be kept somewhere a later page request can read.

decision-1 makes the files the source of truth and the database an index. decision-9 extends that to every piece of durable state: what cannot be rebuilt from the files lives in a file, and `data/geekity.db` may be deleted at rest. A fetched context is a snapshot of a stranger's page. It can be fetched again, but not always with the same result: the page may have changed, moved or gone. A database rebuild that forgot every context would also have to fetch every reply target again, from every boot of a cold index.

Three places were considered.

- **The index.** A column or a table in SQLite. A deleted database loses every preview and refetches every target, and decision-9 says nothing irreplaceable goes there.
- **The reply's own front matter.** Self-contained, but the CMS would rewrite an author's file after every save and every hand edit, which fights the admin's content hash and the file watcher, and mixes a stranger's words into the author's.
- **A data file beside `site.json`.** One JSON object, keyed by the URL a reply answers.

## Decision

The fetched contexts live in `content/_data/replyContexts.json`: one object whose keys are the absolute URLs replies answer, each holding the `name`, `text`, `author` (`name`, `url`) and `published` that page gave, and only those it gave. The file is written atomically, like every other file the CMS writes (decision-9).

- It is in `content/`, not `data/`, because the preview is public: it is printed on a public page, and an Eleventy build of the same directory can read it as the `replyContexts` global.
- It is keyed by the target rather than by the reply, so two replies to one post share one entry, and a reply whose `in-reply-to` changes shows nothing stale: the page looks up whatever the file says now.
- The index gains no column. Rendering a reply reads the file (parsed again only when its bytes change), the way `site.json` is read.
- A save or a sync fetches a target when the reply's `in-reply-to` changed, or when the file holds nothing for it. A scan fetches only what the file has never held, so a deleted database costs no fetches. When the site starts serving it fetches every target a live post replies to that the file lacks, so an upgraded site, or one whose file was removed, catches up without each reply being edited. An entry no live post replies to any more is removed.

## Consequences

- Deleting the database loses no preview, and rebuilding the index sends no request to anybody.
- The file enters the site's git history, with the names of the people whose posts were answered. They published those names on the page the reply links to; git makes them permanent, as it does for followers (decision-9).
- A person can correct or remove an entry by hand. The reader drops an entry that is not a context rather than failing a render.
- A target that could not be read leaves no entry. The reply shows a link-only preview and the next save or boot tries again.
- A preview is as fresh as its last fetch. Nothing refetches a target that has not changed. If previews ever need refreshing on a schedule, that is a job over this file, not a change to where it lives.
