---
id: TASK-195
title: Deleted posts answer 410 Gone
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-06 02:33'
labels:
  - indieweb
  - webmention
  - federation
milestone: m-28
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/federation/article.ts
  - packages/cms/src/webmention/receive.ts
priority: medium
type: feature
ordinal: 211800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 5 asks for deleting your own posts in a way other sites can see. Deleting a post already re-sends webmentions to everything it linked and federates a Delete with a Tombstone, but the post's URL then answers 404, so a receiver that re-fetches cannot tell a deleted post from a mistyped URL, and Webmention receivers are told to treat 410 as deletion. Keep a record of deleted posts' URLs (in files, per decision-9; decision-20 already keeps old URLs for moved posts) and answer 410 Gone at those URLs with a short page, until the URL is used again. Its ActivityPub id should answer a Tombstone with 410.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A deleted post's URL answers 410 Gone with a small HTML page, not 404
- [x] #2 Its ActivityPub id answers 410 with a Tombstone object to an activity+json request
- [x] #3 Publishing a new post at the same URL replaces the 410 with the post
- [x] #4 The record of deleted URLs is kept in files and survives deleting the database
- [x] #5 Webmentions sent on deletion reach targets that then see 410 when they verify
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record: a deleted post is a file in content/_trash/ (TASK-167 deletes and undeletes by moving it there and back). That file keeps its permalink in the index and is re-read on every boot, so it is the file record decision-9 asks for and no second record is written. A trashed document is gone (410) only when it would be served apart from the trash, so a trashed draft or a never-due post stays a 404.
2. web/documents.ts: split hiddenReason into the trash check and the rest; add isGone(document, now) and goneDocumentAt(store, permalink).
3. routes.ts resolveRequest: after every live lookup and the moved-URL redirect, a gone document at the path (or at the path a .md/.json suffix names) answers 410 through a new renderer.renderGone and layouts/410.njk in the default theme. The 410 does not go through negotiateDocument, so it carries no X-Pingback.
4. federation/article.ts: postTombstone(context, document), shared by postDeleteActivity. federation/mount.ts: an activity+json request at a gone post's permalink or stored activitypub.id answers 410 with the Tombstone; a trashed post at its stored id no longer serves its Article.
5. Tests first, per AC: 410 page; AP 410 Tombstone at permalink and stored id; restore and a new post at the URL serve the post again; 410 survives deleting the database; a webmention sent on trashing names a source that answers 410.
6. Update site.test.ts and article.test.ts cases that expected 404 for a trashed post; theme README lists 410.njk.
7. pnpm build, test, typecheck, lint, format:check; curl a running site.

8. AC#3 without emptying the trash: migration 7 makes permalink unique among untrashed rows, getByPermalink prefers the live row, freeSlug ignores trashed holders, moveDocumentFile refuses a restore onto a held URL or file and numbers a trash file rather than overwrite one. Tests first; curl the editor flow.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: M26 lands first, and TASK-167 (Micropub update/delete) includes undelete. The deleted-URL record here must be cleared by an undelete as well as by publishing a new post at the URL, so check how TASK-167 deletes before choosing where the record lives.

Where the record lives: the trash file. TASK-167's Micropub delete and the editor's trash both move the file to content/_trash/, and undelete/restore move it back. The trashed file keeps its permalink in the index and the boot sync re-indexes _trash/, so the record is in files and survives deleting geekity.db with nothing new written. Restore ends the 410 by moving the file. No second record means none can drift from the trash.

A trashed document is gone only when it would be served apart from the trash (web/documents.ts isGone). A trashed draft, a post never due, or one with an unrecognized visibility was never public, so it stays a 404. Pages follow the same rule, so a trashed page also answers 410. The 410 HTML page is layouts/410.njk in the default theme, found through the theme fallback, with the 404's context only. It does not go through negotiateDocument, so it carries no X-Pingback. The .md and .json representations answer 410 too. Order in resolveRequest: after every live lookup and the redirect_from 301, so a live document or a moved post's old URL wins.

ActivityPub: an activity+json request at a gone post's permalink, or at the activitypub.id it stored (decision-14 and decision-20), answers 410 with the Tombstone a Delete carries (postTombstone, now shared with postDeleteActivity). The Tombstone has no deleted instant, because nothing records when a post was trashed. This also fixes a leak: a trashed post with a stored activitypub.id used to serve its full Article at that id.

AC#3, a new post takes the URL while the trashed file stays (replaces the earlier reading, which needed the trash copy removed first):
- content/store.ts migration 7 drops the table-wide UNIQUE index on permalink and creates documents_permalink_live, UNIQUE (permalink) WHERE trashed = 0, plus a plain documents_permalink index so lookups that include trashed rows stay indexed. Permalinks are unique among live documents only. SQLite still names the column in the violation ("UNIQUE constraint failed: documents.permalink"), so isUniqueViolation and DuplicatePermalinkError work unchanged; pathForPermalink now names the live holder.
- getByPermalink orders by trashed, so the live document wins and a trashed one answers only when nothing live holds the URL (the 410 path). getByStoredObjectId prefers a live row the same way. getByFormerPermalink already filters to served documents. Every other permalink reader (publicDocumentAt, previewDocumentAt, goneDocumentAt, canonical feed path, conversation lookups, postByObjectId, Micropub postAt) goes through getByPermalink and so gets the live document.
- freeSlug (editor and Micropub create) skips a slug only when a live document holds its permalink, so a new post whose natural slug matches only a trashed document gets that slug with no -2.
- sync.ts: trashing or restoring by rename no longer produces a permalink conflict, so the stale live row after an outside rename leaves the index on the watcher's unlink event rather than through the conflict path. The comment there now says only live renames conflict. The sync search test now waits for both events.

Same-day collision: a new post on the same day and slug as a trashed one has the same file name. Trashing it later would have overwritten the earlier trash file. moveDocumentFile now numbers the newcomer in the trash (_trash/posts/2026-09-02-gone-2.md). The slug and URL come from the front matter permalink, not the file name, so nothing a reader sees changes.

Restore conflict: moveDocumentFile now returns a MoveOutcome (moved or refused with a reason). A restore is refused, before the file moves, when a live document holds the permalink ("posts/2026-09-10-gone.md now holds /2026/09/gone/, so this cannot go back there. Change one of their permalinks first.") or when a file already sits at the restore path. The editor shows the reason through its existing backTo error flash, the same path that reports "Could not move". Micropub undelete answers the reason as a 400 invalid_request, the same path as its "Could not move". Before this, the restore crashed with a 500 after moving the file and dropping its row.

Micropub undelete names a URL, and the URL now names the live post, so undelete of a URL a new post has taken answers 204 as for any live post and leaves the trashed file where it is. The editor finds a document by slug, newest first, so a trashed post that shares its slug with a newer live one is not reachable in the editor; this is the existing non-unique slug behaviour.

Validation: pnpm build, pnpm test (4682 cms + 30 demo pass), typecheck, lint, format:check all pass. Tests first: store.test.ts (a live document takes a trashed URL; lookup prefers live, falls back to trashed; stored id prefers live; restore over a live holder throws DuplicatePermalinkError naming it; migration 7 on a database with the old index) and gone.test.ts (a hand-written file at the trashed URL serves 200 with the trash copy still present; the editor gives a new "Gone" post /2026/09/gone/ with no -2; a same-day republish then trash keeps both trash files; restore over the live post is refused with the message, the live post still serves and the trash file stays; the 410 cases unchanged). Each went red first; the trash-numbering guard was also mutation-checked. Curl against a scratch site served from dist with every host lookup stubbed to fail: trashed /2026/09/gone/ answered 410 and a 410 Tombstone; after signing in and publishing "Gone" from the editor it answered 200 with the new words, /2026/09/gone-2/ 404, activity+json 200; a restore of a later-dated trashed post at that URL redirected with the refusal message, the live post still served 200, both trash files stayed, and the server log showed no errors. The server was stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post or page moved to the trash (the editor's trash or Micropub delete) now answers 410 Gone at its URL, not 404. The 410 page is layouts/410.njk in the default theme. The .md and .json representations answer 410 as well, and the page sends no X-Pingback. An ActivityStreams request at the post's permalink, or at the activitypub.id it stored, answers 410 with the Tombstone a Delete carries. The record of the deletion is the trash file, so it survives deleting the database. A new post can take the URL while the trashed file stays: index migration 7 makes permalinks unique among live documents only, a lookup prefers the live document, and the editor and Micropub give a new post the natural slug when only a trashed document holds it. Restoring a trashed post whose URL a live post now holds is refused with a message naming the holder, instead of crashing. A same-day republish that is trashed again is numbered in the trash rather than overwriting the earlier file. A trashed draft that was never public stays a 404. This also stops a trashed post with a stored id from serving its Article. Verified by web/gone.test.ts (11 cases, AC1-4), store.test.ts (live-only uniqueness, lookup order, migration on an old database), a send.test.ts case where the target verifies the deletion webmention and gets 410 (AC5), the full pnpm build/test/typecheck/lint/format:check run, and curl of the editor flow against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
