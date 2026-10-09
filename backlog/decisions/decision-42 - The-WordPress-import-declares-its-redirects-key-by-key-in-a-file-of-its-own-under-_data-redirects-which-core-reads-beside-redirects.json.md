---
id: decision-42
title: >-
  The WordPress import declares its redirects key by key in a file of its own
  under _data/redirects/, which core reads beside redirects.json
date: '2026-10-09 18:48'
status: proposed
---
## Context

TASK-291.4 makes the URL forms WordPress answered keep working after a
migration: `/?p=ID`, `/?page_id=ID`, a post's old slug, and an attachment
page. Core already serves three kinds of redirect: a post's `redirect_from`
(decision-20), the declared list in `_data/redirects.json` (TASK-128), and a
post's stored `activitypub.id`, which answers a browser with a 301 for a
post that federates.

The import is rerunnable and never overwrites what the site wrote
(decision-38). `_data/redirects.json` is a list the operator keeps by hand,
and andrewshell.org's migration plan generates more entries into the site
from its old Caddy and Netlify rules. A list has no keys for the import to own
one at a time, and owning the whole file would make every hand-written entry
a clash. The ?p= of a post WordPress withheld must stay indistinguishable from
an id never stored (TASK-297).

## Decision

- **Core reads a folder of redirect files.** Every `*.json` in
  `_data/redirects/` is read after `_data/redirects.json`, in name order, into
  one table. The first declaration of a source wins, so the site's own file
  wins, and the later one is reported. Loops are found across files. A file
  may be the list, or an object mapping each source to its target (301). This
  is the generic extension point (decision-33); nothing in core names
  WordPress.
- **The import owns keys in `_data/redirects/wordpress.json`.** It writes
  through the existing `entries` writer (decision-40), so a key the site added
  or changed there is kept, and `_data/redirects.json` is never touched.
- **Only what WordPress served publicly is redirected.** `/?p=ID` for every
  published post and page without a password, and `/?page_id=ID` for every
  such page, each at its permalink from the posts import. Drafts, pending,
  private, password-protected and scheduled items get none.
- **An attachment page redirects at its file, once the file is copied.** Its
  own link, `/?attachment_id=ID` and `/?p=ID` answer 301 at
  `/uploads/<original>`. An attachment not copied gets no redirect, since a
  redirect to a 404 is worse than the 404.
- **Old slugs and dates go in the post's own `redirect_from`.** The
  permalink's date and slug segments are replaced by each `_wp_old_date` and
  `_wp_old_slug`, and both together, as WordPress's own old-slug and old-date
  lookups answered them.

## Consequences

- These redirects are served by core and work with the plugin disabled,
  unlike the `/wp-content/uploads/` rule (decision-40).
- A published post's `?p=` is also its `activitypub.id`, which the federation
  mount answers before any declared redirect. A site that wants its `?p=` to
  lead elsewhere changes `activitypub.id`, not a redirect file.
- Each request reads the folder as well as the file. The parse is cached
  until a file's text changes.
- A scheduled post's `?p=` is not redirected once it publishes here until the
  import runs again after its date.
- A `#comment-N` fragment never reaches the server; a `?p=ID#comment-N` link
  lands on the post and the browser applies the fragment.
