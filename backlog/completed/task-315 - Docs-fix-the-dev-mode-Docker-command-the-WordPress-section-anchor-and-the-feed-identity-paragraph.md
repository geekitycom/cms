---
id: TASK-315
title: >-
  Docs: fix the dev-mode Docker command, the WordPress section anchor and the
  feed identity paragraph
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 01:13'
updated_date: '2026-10-10 10:34'
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
- [x] #1 The dev-mode go-live command names the geekity service
- [x] #2 The root README's link to the WordPress migration section resolves
- [x] #3 The feed Identity paragraph describes the guid > activitypub.id > permalink order and when isPermaLink is true
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rename the service in the Dev mode on Docker section of packages/cms/README.md from server to geekity, in both the YAML snippet and the exec command, matching deploy/compose.yaml.
2. Point README.md's link at the real heading slug #moving-a-site-from-the-wordpress-activitypub-plugin and match its text to the heading.
3. Rewrite the feed Identity paragraph to match feed-item.ts (front matter guid, then activitypub.id, then permalink; a guid must parse as a URL) and feed-rss.ts (isPermaLink true only when the id equals the permalink).
4. Grep READMEs and docs/ for other occurrences; run pnpm format:check and pnpm lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Also fixed the YAML snippet above the exec command, which named the service server too. Verified: deploy/compose.yaml:26 names the service geekity; the target heading appears once in packages/cms/README.md and slugs to moving-a-site-from-the-wordpress-activitypub-plugin; feed-item.ts:233 sets id = feedGuidOf ?? activityStreamsId ?? link, and feedGuidOf only takes a guid that parses as a URL; feed-rss.ts:162 sets isPermaLink true iff item.id === item.link. Grep of README.md, packages/*/README.md and docs/ finds no other 'exec server', 'server:' service or off-the-wordpress anchor. pnpm format:check and pnpm lint pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed three doc errors: the Dev mode on Docker section of packages/cms/README.md now names the geekity service in both its YAML and its exec command (per deploy/compose.yaml); README.md links to the real slug #moving-a-site-from-the-wordpress-activitypub-plugin; the feed Identity paragraph describes the guid > activitypub.id > permalink order from feed-item.ts and the isPermaLink rule from feed-rss.ts. Verified against the source, by grep for other occurrences, and with pnpm format:check and pnpm lint.
<!-- SECTION:FINAL_SUMMARY:END -->
