---
id: TASK-315
title: >-
  Docs: fix the dev-mode Docker command, the WordPress section anchor and the
  feed identity paragraph
status: To Do
assignee: []
created_date: '2026-10-10 01:13'
labels:
  - docs
milestone: m-31
dependencies: []
priority: low
ordinal: 274800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three small doc errors found while re-reading v0.28.0 for the andrewshell.org migration. (1) packages/cms/README.md:1014 says 'docker compose exec server geekity dev-mode off', but the service in deploy/compose.yaml and the root README is named geekity. (2) README.md:2465 links to packages/cms/README.md#moving-a-site-off-the-wordpress-activitypub-plugin, but the heading at packages/cms/README.md:791 is 'Moving a site from the WordPress ActivityPub plugin', so the anchor is broken. (3) The 'Identity' paragraph under 'What every format says about a post' (packages/cms/README.md:~3107) says a post's guid is its ActivityStreams id. Since TASK-292, a front matter guid comes first: guid, then activitypub.id, then the permalink. isPermaLink is true only when the guid equals the permalink.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The dev-mode go-live command names the geekity service
- [ ] #2 The root README's link to the WordPress migration section resolves
- [ ] #3 The feed Identity paragraph describes the guid > activitypub.id > permalink order and when isPermaLink is true
<!-- AC:END -->
