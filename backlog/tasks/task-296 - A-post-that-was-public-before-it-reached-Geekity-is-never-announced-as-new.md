---
id: TASK-296
title: A post that was public before it reached Geekity is never announced as new
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-08 11:15'
updated_date: '2026-10-09 16:16'
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
- [x] #1 A post whose file records that it was already announced gets no Create from any path (watch, admin, schedule, resend, a fresh or rebuilt DB)
- [x] #2 A post whose file records that it was public before the migration but never federated gets no Create and no Update from any path, including a later edit and a reply context arriving; it is still served to a peer that fetches its id
- [x] #3 An edit to an already-announced post sends one Update, as for any announced post
- [x] #4 A post first published on Geekity behaves exactly as today
- [x] #5 The scheduler never announces a post dated before the scheduler first ran on this site, whatever the stored watermark says
- [x] #6 delivery.citedPageStored only revises posts that were announced
- [x] #7 The same rule keeps webmentions and feed pings quiet for posts that were public before the migration, until a real edit
- [x] #8 doc-2 documents the front matter that records it; tests cover each path above
- [x] #9 A draft imported from content that was public before the migration (andrewshell.org restores 63 such essays) stays quiet when it is published later. It appears on the web and in listings at its original date, and sends no ActivityPub activity, webmention, feed ping or IndexNow submission
- [ ] #10 The rule lives in core and names no CMS a post came from; the WordPress importer only writes the front matter
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a top-level front matter key `migrated: true` records that a post was public before it reached this site. `activitypub.published` keeps meaning followers already hold it. The two are independent, so the importer writes `migrated: true` on every post it brings over and `activitypub.published` (and `activitypub.id`) only on the ones that federated.
2. content/migrated.ts: isMigrated(document) and isMigratedArrival(change, now): a migrated document coming into public view (no previous version, or one that was not served). One core rule, no CMS named.
3. federation/delivery.ts: handle() sends nothing for a migrated post that was never announced, and nothing when a migrated post arrives (watch, admin publish, schedule). Edits to a migrated announced post go through as Update; withdrawals of one as Delete. resend() answers undefined for a migrated post never announced. citedPageStored already reads listFederated (stamped only); prove it with a test.
4. webmention/service.ts handle() and originalFound(), notify.ts feedsFor(), indexnow.ts urlsFor(): nothing for a migrated arrival; a real edit (a change to a version that was already public) goes out as today.
5. content/schedule.ts: record the instant the scheduler first ran on this site in admin state (schedule.firstRun) and never release a post dated before it, whatever the watermark says. A site upgrading records it on its first run under this version.
6. Tests first for each AC: a site-level test (src/migrated-site.test.ts) with a follower, a webmention target, a notify server and IndexNow, covering watch, admin, schedule, resend, rebuilt DB, edit, reply context, peer fetch of the stored id, and a migrated draft published later; scheduler unit test for the floor.
7. Docs: doc-2 front matter row for `migrated`, doc-4 delivery table, decision-36.
8. Verify: pnpm build, test, typecheck, lint, format:check; deslop and no-comments over the diff.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Front matter: `migrated: true` (top level) records that a post was public before it reached the site; `activitypub.published` keeps meaning its followers hold it. The importer writes `migrated: true` on every post and `activitypub.published` + `activitypub.id` only on the ones that federated. decision-36 records it; doc-2 has the row, doc-4 a paragraph under the delivery table.

Rule lives in packages/cms/src/content/migrated.ts: isMigrated, and isMigratedArrival (a migrated document whose previous version was absent or not served). Callers: delivery.handle (a migrated post that was never announced, or one only coming into view, sends nothing and is not stamped; an announced one gets Update on edit and Delete on withdrawal), delivery.resend (undefined for a migrated post never announced), webmention handle and originalFound, notify.feedsFor, indexnow.urlsFor. citedPageStored already reads listFederated, which is stamped posts only, so AC #6 held before this task; migrated-site.test.ts now proves it.

Scheduler: ScheduleWatermark gained readFirstRun/writeFirstRun, stored as schedule.firstRun in cms_state. release() records it on the first run and opens its window at max(watermark, firstRun). A site upgrading into this version records firstRun on its first boot, so a scheduled post that came due while it was down across the upgrade is not caught up.

Posts without `migrated` behave exactly as before; I chose not to key AC #1 on `activitypub.published` alone because that would turn a Geekity post's restore-from-trash and re-scheduling Creates into something else, breaking AC #4 (the existing restore test pins the Create).

Tests: src/migrated-site.test.ts (control post, watch arrival, fresh DB then edits, scheduler arrival, resend, citedPageStored, peer fetch of stored id, migrated draft published from admin then edited); content/schedule.test.ts (two floor tests; harness now seeds firstRun); webmention/original-post-discovery.test.ts (migrated reply tells the original nothing; control does). Each failed before the change for the intended reason (outbound POSTs listed, quiet post got Update, resend returned a Create report, scheduler announced pre-first-run post).

Verification: pnpm build, test (cms 5137 pass), typecheck, lint, format:check all pass. Curled a running site: GET http://localhost:4893/?p=42 with Accept application/activity+json returned 200 with the object for a migrated never-federated post; geekity resend an-old-essay printed 'nothing to resend'. Server stopped.

AC #10 left unchecked: the core half holds (no CMS is named anywhere in the rule, and plugin-wordpress contains nothing about it), but 'the WordPress importer only writes the front matter' can only be shown by TASK-291.1, which does not exist yet.

Added an admin-path test for an announced migrated draft published from the editor (silent). After the comment review, isQuietMigration was inlined into handle() as two named conditions (followersHoldIt, comingIntoView).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A top-level front matter key, migrated: true, records that a post was public before it reached the site. The rule lives in core (content/migrated.ts) and names no CMS. When a migrated post comes into view, whether as a new file, a published draft or a date passing, it sends no ActivityPub activity, webmention, feed ping or IndexNow submission. A migrated post with activitypub.published gets an Update on a real edit and a Delete when it is withdrawn. One without it is never federated, and its object is still served at its stored id. The scheduler keeps schedule.firstRun and never releases a post dated before it. Posts without migrated behave as before. decision-36, doc-2 and doc-4 updated. Verified with src/migrated-site.test.ts, the schedule and original-post-discovery tests, and a full pnpm build/test/typecheck/lint/format:check. A curl of a running site showed a 200 object at /?p=42. AC #10 stays open until the WordPress importer (TASK-291.1) shows it writes only front matter.
<!-- SECTION:FINAL_SUMMARY:END -->
