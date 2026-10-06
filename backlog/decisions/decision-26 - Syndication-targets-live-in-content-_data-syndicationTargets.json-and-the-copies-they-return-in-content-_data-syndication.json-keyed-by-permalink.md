---
id: decision-26
title: >-
  Syndication targets live in content/_data/syndicationTargets.json and the
  copies they return in content/_data/syndication.json keyed by permalink
date: '2026-10-02 14:57'
status: accepted
---
## Context

TASK-155 gives a site syndication targets: services such as IndieNews and Bridgy Publish that copy a post when it links to them and sends them a webmention, and answer `201` or `202` with a `Location` naming the copy. Two things need a home. The list of targets is the site's own configuration. The URL each target answers with is a fact learned from somebody else's server after a save, and the post should print it as `u-syndication`.

decision-9 puts every piece of durable state in a file. decision-19 settled the same question for reply contexts: data fetched after a save does not go into the post's front matter, because the CMS would then rewrite an author's file in the background, against the admin's content hash and the file watcher, and possibly while the file is open in the editor.

Three places were considered for the returned URLs.

- **The index.** Lost with the database, and decision-9 forbids it for anything that cannot be rebuilt. A copy URL cannot be rebuilt without sending the webmention again.
- **The post's `syndication` front matter.** Self-contained and readable by any mf2 tool, but a background job would rewrite the author's file after every send, which is what decision-19 refused.
- **A data file beside `site.json`.** One JSON object keyed by post.

## Decision

- A site declares its targets in `content/_data/syndicationTargets.json`: a JSON array of `{ id, name, url, tag? }`. `id` is what a post's `syndicate-to` lists and what Micropub will offer as the target's `uid` (TASK-168). An object per target leaves room for TASK-156's per-language fields. Nothing is built in: no file means no targets. An entry that is not a target is reported when the site starts serving and ignored.
- A post selects targets with a `syndicate-to` front matter list of ids, or by carrying a target's `tag`.
- The copies targets answer with live in `content/_data/syndication.json`: one object keyed by the post's permalink, each value mapping a target's URL to the URL of its copy. The file is written atomically under the per-file lock, and only when something changed.
- It is keyed by permalink because that is what a theme and an Eleventy build already know about a page (`syndication[page.url]`), and by target URL inside because that is what a webmention outcome is about. A post that moves has its old key dropped; its targets are sent the new source and answer with copies under the new key.
- Copies an author made by hand go in the post's own `syndication` front matter. The CMS never writes that key.
- It is in `content/`, not `data/`, because the copies are public: they are printed on the post.

## Consequences

- Deleting the database loses no copy URL, and rebuilding the index sends nothing.
- The file enters the site's git history. It holds only URLs of public copies.
- A target that is deselected, or a post that is drafted or trashed, is notified as any unlinked page is, and its copy is removed from the file.
- A person can edit or remove an entry by hand. The reader drops an entry that is not a URL rather than failing a render.
- The default theme no longer hard-codes the IndieNews link for posts tagged `indienews`. A site that relied on it declares an IndieNews target with `tag: indienews`.

## Amendment (2026-10-05, TASK-197)

The copies are also how a response finds its way home. A webmention whose target is not on this site is accepted when the target is one of a public post's copies, listed by hand under the post's `syndication` front matter or recorded for it in `content/_data/syndication.json`. The source is checked for a link to the copy it named, and what it says is stored as a response to the post the copy is of. A target elsewhere that is no copy of a post here is still refused.
