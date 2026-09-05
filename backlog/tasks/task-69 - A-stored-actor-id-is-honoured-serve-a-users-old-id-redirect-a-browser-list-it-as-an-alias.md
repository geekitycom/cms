---
id: TASK-69
title: >-
  A stored actor id is honoured: serve a user's old id, redirect a browser, list
  it as an alias
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
labels:
  - federation
  - admin
milestone: m-11
dependencies:
  - TASK-68
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/admin/accounts.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/federation/actor.ts
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14: a user record may carry the actor id they had elsewhere, such as https://andrewshell.org/?author=2, and it is identity rather than cache. The CMS never mints one, but when data/users.json names one for a user, that exact URL returns the user's actor document on an ActivityStreams request with that URL as its id and {id}#main-key as its key id, returns a 301 to the author archive otherwise, and appears in WebFinger's aliases beside the author URL and /@{username}. Matching is on the whole URL, query string included, and happens before the public site resolves the path, so a stored id on the site root with a query string works. Activities the user sends name the stored id as actor. The users screen shows a stored id read-only with a note that it is what the fediverse knows this user by; it is set by the import (TASK-71) or by hand in the file, never by the screen. This is the same rule TASK-65 applies to a post's activitypub.id, done for people, and the spike (TASK-66) says how the id and key id are produced under Fedify.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a stored actor id in data/users.json, an ActivityStreams GET of that URL returns the Person whose id is that URL and whose publicKey id is that URL plus #main-key, and a browser GET is a 301 to the author archive
- [ ] #2 WebFinger for the user lists the stored id, the author URL and /@{username} as aliases and resolves a lookup by any of them to the same actor
- [ ] #3 Create, Update, Delete and Accept activities the user sends name the stored id as actor, and a peer verifying the signature through fedify lookup accepts them
- [ ] #4 A stored id with a query string on the site root (?author=2) is served the same as one with a path, and does not disturb the home page for any other request
- [ ] #5 The users screen shows the stored id read-only with its note; a user without one behaves exactly as before
- [ ] #6 doc-4 and the package README describe the stored-id rule for users beside the one for posts
<!-- AC:END -->
