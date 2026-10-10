---
id: TASK-338
title: Imported fediverse reactions keep their actors' avatars
status: To Do
assignee: []
created_date: '2026-10-10 22:40'
labels:
  - enhancement
milestone: m-31
dependencies: []
priority: low
ordinal: 297800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import (2026-10-08 export). Prod's post pages show a facepile of avatars for likes and boosts (13 on post 1130). Geekity shows names with a heart icon, because every imported record has avatar: null. The data is in the WXR. Each fediverse comment's _activitypub_remote_actor_id points at one of 27 ap_actor items, the ActivityPub plugin's cached actor profiles, whose content is the actor JSON with its id and icon (e.g. 258 is https://indieweb.social/users/andrewshell). plugin-wordpress skips ap_actor items and never follows the reference. Proposal: the importer resolves each fediverse comment's actor from the WXR and writes its avatar URL (and, with TASK-336, its actor id) into the record. core's remote-avatar cache (TASK-134) then serves it like any other. Gravatars for WordPress form comments are out of scope: a Geekity form comment has no picture by design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 plugin-wordpress resolves _activitypub_remote_actor_id through the WXR's ap_actor items and writes the actor's avatar URL into each fediverse comment it imports
- [ ] #2 On the andrewshell.org import, post 1130's likes and boosts show avatars, served through the avatar cache
- [ ] #3 A comment whose actor is missing from the WXR imports as today, with no avatar
<!-- AC:END -->
