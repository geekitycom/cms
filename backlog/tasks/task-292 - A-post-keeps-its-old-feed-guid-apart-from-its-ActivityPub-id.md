---
id: TASK-292
title: A post keeps its old feed guid apart from its ActivityPub id
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
updated_date: '2026-10-08 11:00'
labels: []
milestone: m-31
dependencies: []
priority: high
ordinal: 252800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A feed item's guid is the post's activitypub.id when set, else its permalink. WordPress keeps the two apart: on andrewshell.org, post 813 federated as https://andrewshell.org/?p=813 but its RSS guid is https://andrewshell.org/2026/08/meet-me-at-wordcamp/, and posts carried over from the Eleventy site have guids like https://blog.andrewshell.org/essays/<slug>/. After a migration Geekity changes those guids, and every feed reader shows those posts again as new. A post needs a way to keep the guid its readers already have, whatever its federated id is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A front matter key (named in doc-2) sets the guid the RSS, Atom and JSON feeds publish for a post, independent of activitypub.id
- [ ] #2 Without that key the guid is unchanged: activitypub.id, else the permalink
- [ ] #3 The key does not change the ActivityPub object id, the permalink or any redirect
- [ ] #4 The editor keeps the key on save, and doc-2 documents it
<!-- AC:END -->
