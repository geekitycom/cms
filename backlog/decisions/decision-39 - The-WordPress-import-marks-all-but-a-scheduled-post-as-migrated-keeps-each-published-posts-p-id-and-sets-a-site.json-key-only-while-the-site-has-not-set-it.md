---
id: decision-39
title: >-
  The WordPress import marks all but a scheduled post as migrated, keeps each
  published post's ?p= id, and sets a site.json key only while the site has not
  set it
date: '2026-10-09 17:36'
status: proposed
---
## Context

TASK-291.1 turns WordPress posts and pages into files. Three choices in it
decide what the site later does with them, and the acceptance criteria do not
settle any of them.

- decision-36 defines `migrated: true` as "public somewhere else before it
  reached this site". A WordPress export also holds drafts, scheduled posts and
  private posts. Some of these were public before WordPress: andrewshell.org's
  draft 123 carries the guid of an Eleventy essay
  (`https://blog.andrewshell.org/essays/added-blogroll/`).
- The ActivityPub plugin serves every published post as an object at
  `https://example.com/?p=ID`, whether or not it ever delivered it. Of 160
  posts on andrewshell.org it delivered 21.
- WordPress keeps the static front page in an option (`page_on_front`) that
  the export leaves out. Geekity keeps it as `homepage` in `_data/site.json`,
  a file the site owns.

## Decision

- **Everything but a scheduled post is migrated.** A published, draft, pending,
  private or password-protected post or page gets `migrated: true`. The import
  cannot tell a draft that was never public from one that was, and an old post
  announced as new is the failure the migration must not have, while a quiet
  publish is fixed by removing the key. A scheduled post gets none: WordPress
  would have announced it, and so does the site.
- **Every published post keeps its `?p=` id.** `activitypub.id` is written on
  each published post, so a peer that fetched it from WordPress, or a reply to
  it, still resolves. `activitypub.published` is written only on the posts the
  plugin federated (`activitypub_status` is `federated`), with the post's
  `post_date_gmt`, which is the `published` the plugin sent. Without it the
  post is never federated (decision-36). A post WordPress never served gets no
  `activitypub.id`.
- **A post's WordPress guid is kept when it is not its `?p=` address**, so the
  feeds print what WordPress's feeds printed (TASK-292), and a draft that once
  had another guid keeps it for the day it is published.
- **The front page is the page WordPress served at the home URL.** Its file
  keeps its own permalink (`/home-page/`), and `homepage` names it.
- **A `site.json` key is owned like a file (decision-38).** `import.json`
  records each key's value as the import last set it. The key is written when
  the site has not set it, or still holds that value. A key the site set
  itself is a clash, and one changed since the import set it is kept. No other
  key of the file is touched.
- **A status post has no title.** On andrewshell.org every status post has a
  WordPress title the theme hid. D4 of the migration plan makes them notes.

## Consequences

- A WordPress draft that was never public, published here later, appears
  quietly: no activity, webmention, feed ping or IndexNow. To announce it,
  remove `migrated` before publishing.
- A status post's WordPress title is not carried over. Its slug, in the
  permalink, still says it.
- Losing `import.json` makes the import treat its own `homepage` as the site's
  and leave it alone.
