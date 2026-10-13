---
id: TASK-338
title: Imported fediverse reactions keep their actors' avatars
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 22:40'
updated_date: '2026-10-11 00:41'
labels:
  - enhancement
milestone: m-31
dependencies:
  - TASK-336
priority: low
ordinal: 297800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import (2026-10-08 export). Prod's post pages show a facepile of avatars for likes and boosts (13 on post 1130). Geekity shows names with a heart icon, because every imported record has avatar: null. The data is in the WXR. Each fediverse comment's _activitypub_remote_actor_id points at one of 27 ap_actor items, the ActivityPub plugin's cached actor profiles, whose content is the actor JSON with its id and icon (e.g. 258 is https://indieweb.social/users/andrewshell). plugin-wordpress skips ap_actor items and never follows the reference. Proposal: the importer resolves each fediverse comment's actor from the WXR and writes its avatar URL (and, with TASK-336, its actor id) into the record. core's remote-avatar cache (TASK-134) then serves it like any other. Gravatars for WordPress form comments are out of scope: a Geekity form comment has no picture by design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 plugin-wordpress resolves _activitypub_remote_actor_id through the WXR's ap_actor items and writes the actor's avatar URL into each fediverse comment it imports
- [x] #2 On the andrewshell.org import, post 1130's likes and boosts show avatars, served through the avatar cache
- [x] #3 A comment whose actor is missing from the WXR imports as today, with no avatar
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core: add an optional top-level actor (the fediverse actor id) to CommentRecord and PluginComment, like origin and user: actorField helper, comments file read/write, published entry, index column (admin migration 29), plugin site mapping.
2. Core: a stored comment's Interaction.author.actorId is its actor; the reaction fold key is kind + actor id on both sides (stored record's actor, inbox row's actorId). Drop the author.url key from TASK-336. Test: an imported like whose actor's profile the site does not hold and a re-like under a new activity id fold to one.
3. plugin-wordpress: read ap_actor items (content is actor JSON: id, icon) into a map by post id; resolve each fediverse comment's _activitypub_remote_actor_id; write actor (the id) and author.avatar (icon url, an Image url or a Link href) on the record. A missing or unreadable actor imports as today. Tests for both.
4. Prove AC#2: import the andrewshell.org WXR into a scratch site, serve it, curl post 1130 and check the likes and boosts point at /avatars/... keys that decode to the actors' icon URLs, and that the avatar route answers for them (no real fetch needed).
5. pnpm build/test/typecheck/lint/format:check; READMEs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: CommentRecord.actor?: string and PluginComment.actor (the fediverse actor id), top-level beside origin and user rather than inside CommentAuthor, so no CommentAuthor builder or the erasure shape changes. actorField helper in admin/store.ts; comment file (records.ts both writers + reader), cache column actor (migration 29), plugin view (plugins/site.ts both ways). Stored comment's Interaction.author.actorId is its actor.
Fold: reaction key is kind + actor id on both sides (stored record's actor, inbox row's actorId). Deleted the TASK-336 author.url key and its naming() lookup before the dedupe; the profile no longer matters. Records without actor (imported before this, or actor missing from the export) do not fold; a re-import gives them one.
plugin-wordpress: remoteActors() reads ap_actor items (JSON content, string id required; icon as Image url, Link href, or first of an array) by post id; each activitypub comment resolves _activitypub_remote_actor_id to actor + author.avatar (a comment's own avatar meta still wins). Missing or unparseable actor imports as before. A comment the site has since moderated still gets its actor on a rerun (identity branch in writeComments).
Tests: backfill.test.ts imported like now carries actor; re-like under a new id folds with and without a held profile (red before), another actor's like stays separate. comments-import.test.ts: Image/Link/no-icon actors, missing/unreadable actor, moderated comment gets actor, page prints /_geekity/avatars/ keys and isAvatarSource.
AC#2: scratchpad/site338, real andrewshell.org WXR imported with dist/cli.js + plugin-wordpress dist; 41 records carry actor. Served on 4343: /2026/10/the-web-of-markdown/ (post 1130) shows Likes 3, Boosts 2, five <img class="avatar u-photo" src="/_geekity/avatars/..."> whose keys decode to the five actors' icon URLs; no remote avatar URL in the HTML. The server's own avatar sweep fetched the pictures at boot (20 files in data/avatars); each of the five /_geekity/avatars/ URLs answered 200 image/webp from the cache. Server stopped. Prod's 13 faces on 1130 include reactions after the 2026-10-08 export; the export holds 5.
Gates: pnpm build, test (cms 5421, plugin-wordpress 99, all pass), typecheck, lint, format:check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Imported fediverse likes, boosts and replies now carry their actor's avatar and actor id. plugin-wordpress resolves _activitypub_remote_actor_id through the export's ap_actor items; core stores the id as CommentRecord.actor (migration 29) and folds reactions by actor id on both sides, replacing the TASK-336 profile-page key, so an imported like and a later re-like under a new activity id are one even when the site holds no profile. Verified by red-then-green tests in cms and plugin-wordpress, all gates, and a scratch import of the real WXR where post 1130's 3 likes and 2 boosts show faces served from /_geekity/avatars/.
<!-- SECTION:FINAL_SUMMARY:END -->
