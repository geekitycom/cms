---
id: TASK-256
title: Show a titled post's heading when it has no body text
status: To Do
assignee: []
created_date: '2026-10-04 00:20'
labels:
  - theme
  - content
dependencies: []
priority: medium
type: bug
ordinal: 271800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me (0.19.0) the repost /2026/10/scientific-calculator/ has title 'Scientific Calculator' and no body. The title reaches <title>, og:title and JSON-LD, but the page shows no heading: the theme's named flag comes from isNamedPost in packages/cms/src/content/post-type.ts, which (following Post Type Discovery) counts a post with a name and no content as unnamed, so the default theme takes the untitled layout. A title the author typed should show. Separate whether the page shows a heading from the post type: a post whose title is non-empty and not just its content's first words shows its header, on its page and in listings, while post type discovery and mf2 keep their current results unless a test shows they are wrong too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A like, repost or bookmark with a title and no body shows its title as the page heading and in listings, with the citation after it (TASK-241's order)
- [ ] #2 A note whose name only repeats its content still shows no heading; post type discovery results are unchanged
- [ ] #3 Tests cover a titled bodiless repost, like and bookmark
<!-- AC:END -->
