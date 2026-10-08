---
id: TASK-296
title: A post that was public before it reached Geekity is never announced as new
status: To Do
assignee: []
created_date: '2026-10-08 11:15'
updated_date: '2026-10-08 11:51'
labels: []
milestone: m-31
dependencies: []
priority: high
ordinal: 256800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Federation decides Create vs Update from the disposable SQLite index alone. delivery.ts handle() sends a Create whenever a federated post has no previous row, and never consults activitypub.published or activitypub.id. Only origin scan is skipped. So migrated posts can be announced to followers as new in several ways: a file written while the watcher runs, an existing data/ whose schedule watermark is older than imported 2026 posts, geekity resend --all, an edit to a migrated post that was never federated (it gets an Update), and delivery.citedPageStored sending Updates for posts that were never announced when a reply context arrives. That last path has no scan guard.

A migrated site knows which posts its followers already saw. On andrewshell.org WordPress federated 21 of 160 posts (activitypub_status = federated); the other 139, essays from 2004 to 2025, were never sent. Whether a post was announced should be part of the post's file, so it survives a rebuild and a fresh data/ directory. Federation should follow it: never announce a post again, and never send activity about a post that was not federated before the migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post whose file records that it was already announced gets no Create from any path (watch, admin, schedule, resend, a fresh or rebuilt DB)
- [ ] #2 A post whose file records that it was public before the migration but never federated gets no Create and no Update from any path, including a later edit and a reply context arriving; it is still served to a peer that fetches its id
- [ ] #3 An edit to an already-announced post sends one Update, as for any announced post
- [ ] #4 A post first published on Geekity behaves exactly as today
- [ ] #5 The scheduler never announces a post dated before the scheduler first ran on this site, whatever the stored watermark says
- [ ] #6 delivery.citedPageStored only revises posts that were announced
- [ ] #7 The same rule keeps webmentions and feed pings quiet for posts that were public before the migration, until a real edit
- [ ] #8 doc-2 documents the front matter that records it; tests cover each path above
- [ ] #9 A draft imported from content that was public before the migration (andrewshell.org restores 63 such essays) stays quiet when it is published later. It appears on the web and in listings at its original date, and sends no ActivityPub activity, webmention, feed ping or IndexNow submission
- [ ] #10 The rule lives in core and names no CMS a post came from; the WordPress importer only writes the front matter
<!-- AC:END -->
