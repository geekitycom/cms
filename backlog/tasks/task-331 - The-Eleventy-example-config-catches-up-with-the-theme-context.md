---
id: TASK-331
title: The Eleventy example config catches up with the theme context
status: To Do
assignee: []
created_date: '2026-10-10 18:09'
labels:
  - themes
  - eleventy
dependencies: []
references:
  - packages/cms/docs/eleventy.config.example.js
priority: low
type: docs
ordinal: 290800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/docs/eleventy.config.example.js claims to build the default theme the way the CMS does, but it has fallen behind several changes: newestPosts(count) on the front page (TASK-317, which replaced recentPosts, never mirrored either); native comment urls are still #comment-{id} rather than /comment/{id}/ (TASK-318), which is right only if a static build has no comment pages and should say so; a visible reply under a hidden comment is dropped where the CMS shows a placeholder (TASK-325); reply posts shown inline in threads (TASK-300); and backlinks (TASK-322). Decide per feature whether the example mirrors it or documents that a static build leaves it out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An Eleventy build of a site using the default theme front-page override with newestPosts(5) succeeds
- [ ] #2 For comment pages, placeholders, inline reply posts and backlinks, the example either mirrors the CMS or says in its header which it leaves out and why
- [ ] #3 The example's claim to match the CMS is accurate
<!-- AC:END -->
