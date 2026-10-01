---
id: TASK-207
title: 'Pinned posts: the ActivityPub featured collection'
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
labels:
  - federation
  - admin
  - theme
dependencies: []
references:
  - packages/cms/src/federation/actor.ts
  - packages/cms/src/admin/documents.ts
priority: low
type: feature
ordinal: 223800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mastodon shows an account's pinned posts at the top of its profile, read from the actor's featured collection (toot:featured). Let a user pin up to a handful of their published posts from the post editor (a pinned flag in front matter, so it lives in the file), publish the actor's featured collection as an OrderedCollection of those posts' objects, and send the Add/Remove activities Mastodon expects when a pin changes. The default theme may also show pinned posts first on the author archive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A user can pin and unpin a published post from the editor, stored as front matter
- [ ] #2 The actor document links a featured collection listing the user's pinned posts in order
- [ ] #3 Pinning and unpinning federate Add and Remove to followers, and a pinned post that is deleted or unpublished drops out
- [ ] #4 A Mastodon instance shows the pinned posts on the profile, or the notes record what was checked
<!-- AC:END -->
