---
id: TASK-144
title: 'Default theme: an h1 on every page, including untitled notes and replies'
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - accessibility
  - seo
  - theme
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/seo/heading-hierarchy/'
priority: medium
type: bug
ordinal: 168800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
post.njk renders an h1 only for a named post. The page of an untitled note or reply has no h1, which leaves screen-reader users and crawlers with no top-level heading to navigate by.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every single-post page in the default theme has exactly one h1
- [ ] #2 For an untitled post the h1 is meaningful (for example, the author and date) and can be visually hidden so the note's look is unchanged
- [ ] #3 Heading levels below it never skip a level
<!-- AC:END -->
