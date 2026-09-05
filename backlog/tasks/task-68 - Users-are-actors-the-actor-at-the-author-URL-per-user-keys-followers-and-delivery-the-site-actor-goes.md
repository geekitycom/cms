---
id: TASK-68
title: >-
  Users are actors: the actor at the author URL, per-user keys, followers and
  delivery; the site actor goes
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
labels:
  - federation
  - admin
  - content
milestone: m-11
dependencies:
  - TASK-66
  - TASK-67
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/federation/federation.ts
  - packages/cms/src/federation/actor.ts
  - packages/cms/src/federation/keys.ts
  - packages/cms/src/federation/records.ts
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/federation/paths.ts
  - packages/cms/src/admin/federation.ts
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the site actor (doc-4) with one actor per user, per decision-14. A user's actor is served at /author/{username}/ on an ActivityStreams request, with the profile from TASK-67 as name, summary, icon and attachments, preferredUsername the username, manuallyApprovesFollowers false, and its collections at /author/{username}/inbox/, /outbox/, /followers/ and /following/; the shared inbox is /inbox/ and inbox is reserved. WebFinger answers acct:{username}@host with the author URL and /@{username} as aliases, and /@{username} redirects to the archive. Each user has a key pair under data/keys/ named by the user, minted on first need and checked at boot as the site's is today. Followers are kept per user: content/_data/federation/{username}/followers.json, with the inbox log attributing each activity to the actor it was addressed to and the indexes rebuilt on boot as now. A post is delivered to its author's followers and to the relays; the outbox lists the author's posts; a Delete or Update comes from the author. The federation screen shows the actors and their followers and deliveries per user. Remove the site actor, /ap/actor and its collections, the actorHandle, actorType and avatar settings and the site avatar upload, and SITE_ACTOR_IDENTIFIER, and take the spike's findings (TASK-66) for how the actor id and key id are produced. This is feat(cms)!: a site that federated as the site actor starts again as its users, and no migration of the site actor's followers is provided. The demo is reset to federate as its admin user.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 fedify lookup @{username}@host returns a Person at the author URL with the profile fields, preferredUsername, inbox, outbox, followers, following, the shared inbox at /inbox/ and a public key; a browser GET of the same URL is the archive
- [ ] #2 A Follow delivered to /author/{username}/inbox/ or /inbox/ is accepted, the follower lands in that user's followers.json and index, and an Undo removes it; the followers collection pages them
- [ ] #3 Publishing a post delivers Create to its author's followers only and Update and Delete likewise; the outbox pages the author's posts; the fed-smoke job passes against the per-user actor
- [ ] #4 Each user's key pair lives under data/keys/ named by the user, is minted on first need and refused at boot when unreadable, exactly as the site's keys were; a rebuilt database re-reads every user's followers
- [ ] #5 The site actor, /ap/actor, the actor settings and the site avatar are gone, /ap/ is unregistered, and the settings screen and doc-4 no longer mention them; the federation screen is per user
- [ ] #6 The commit is feat(cms)! with a BREAKING CHANGE footer; doc-4 is rewritten around user actors and the package README's route table follows
<!-- AC:END -->
