---
id: TASK-184
title: 'Name and picture every fediverse actor, not only followers'
status: To Do
assignee: []
created_date: '2026-09-29 12:35'
labels:
  - federation
  - comments
dependencies: []
references:
  - 'https://shll.me/2026/09/test-004-long-content/'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
priority: medium
type: bug
ordinal: 207800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On https://shll.me/2026/09/test-004-long-content/ a like from mastodon.social shows as "@117132440785278319@mastodon.social" with no avatar, linking to https://mastodon.social/ap/users/117132440785278319 (which mastodon.social redirects to /@nicopeaks). Only followers are named properly: authorNaming in packages/cms/src/web/conversation.ts reads their stored profile, and everyone else is named by actorHandle in src/federation/replies.ts, which guesses @user@host from the last segment of the actor URL. That guess worked for /users/{name} ids, but newer Mastodon versions mint numeric ids (/ap/users/{number}) that carry no username, so every like, boost, reply and quote from a non-follower on such a server gets a number for a name and no avatar. The inbox already verifies each activity signature, which dereferences the sender, so the profile can be captured at receipt rather than fetched while a page is served. A remote profile can always be refetched, so it belongs in the disposable cache under decision-9, not in content files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When an activity arrives from an actor the site does not know, its display name, @preferredUsername@host handle, profile url and icon are stored, without delaying the inbox response and without any fetch while a page is served
- [ ] #2 Conversations name an actor from a follower record first, then the stored profile, and fall back to a guess only when neither exists
- [ ] #3 The fallback never shows a numeric id as a handle: an actor whose URL ends in a number and has no stored profile is shown by its server, for example someone on mastodon.social
- [ ] #4 A stored profile's icon is served through the avatar proxy (TASK-134) like a follower's, and the proxy still refuses URLs the site has not recorded
- [ ] #5 Links go to the actor's profile url when known, else the actor id
- [ ] #6 Stored profiles are refreshed in the background and can be deleted with the cache and rebuilt, proven by a test that deletes the database
- [ ] #7 Interactions already in the inbox log are backfilled once, so the like on test-004-long-content shows a real name and avatar
- [ ] #8 Tests use a Mastodon-shaped actor with a numeric /ap/users/ id
<!-- AC:END -->
