---
id: TASK-186
title: 'Default theme: comments heading quotes an empty title on untitled posts'
status: To Do
assignee: []
created_date: '2026-09-30 04:31'
labels:
  - theme
  - accessibility
dependencies: []
priority: low
type: bug
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On an untitled note or reply with comments, h2.comments-title in packages/cms/themes/default/partials/conversation.njk (line ~126) prints 'One comment on “”' because it quotes the empty `title`. Found while building TASK-144, which gave untitled posts a hidden h1 naming the post type, author and date.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An untitled note with comments has a comments heading that names no empty title (for example 'One comment' or a heading using the post's label)
- [ ] #2 A titled post's comments heading is unchanged
- [ ] #3 A test over HTTP covers both cases
<!-- AC:END -->
