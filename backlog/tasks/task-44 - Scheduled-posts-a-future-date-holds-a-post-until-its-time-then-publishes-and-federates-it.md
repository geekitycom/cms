---
id: TASK-44
title: >-
  Scheduled posts: a future date holds a post until its time, then publishes and
  federates it
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - content
  - federation
milestone: m-5
dependencies:
  - TASK-4
  - TASK-11
  - TASK-19
references:
  - backlog/docs/doc-2 - Content-Format-(11ty-compatible-Markdown).md
type: feature
ordinal: 27800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post whose `date` is in the future is published the moment it is saved; WordPress holds it as "Scheduled" and publishes on the date. Treat a future-dated, non-draft post as not yet public: it is absent from listings, archives, feeds, the outbox, the sitemap and the public permalink (404, or a preview for a signed-in admin), and the index answers `isPublicDocument` accordingly. The CMS keeps a timer for the next due post (recomputed on every index change) and, when the time arrives, treats it as a `published` change so the same delivery path sends the `Create(Article)` and the rssCloud ping. A file whose date passed while the server was down publishes on the next boot scan without federating twice (the `activitypub.id` stamp already guards that). The admin lists scheduled posts with a Scheduled filter and status, and the editor shows the scheduled time in the site's time zone. Eleventy's own build has no clock, so document that a future-dated post is simply built there; the example config may filter on date to match.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A non-draft post dated in the future is absent from the home page, archives, feeds, the outbox and its permalink until that time, and appears in the admin as Scheduled
- [ ] #2 When the date arrives the running server publishes it without a restart and followers receive Create(Article) once, proved with a fake clock
- [ ] #3 A post whose date passed while the server was down is public on the next boot and federated once
- [ ] #4 Editing the date of a scheduled post moves the timer; making it a draft cancels it
- [ ] #5 The README documents scheduling and its Eleventy caveat
<!-- AC:END -->
