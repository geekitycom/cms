---
id: TASK-79
title: >-
  Context for the design: siteAuthor on every page, summary on listing entries,
  previous and next on a post, recentPosts on the front page, and job title and
  location on the user profile
status: To Do
assignee: []
created_date: '2026-09-13 13:36'
labels:
  - web
  - admin
milestone: m-14
dependencies:
  - TASK-78
references:
  - packages/cms/src/web/context.ts
  - packages/cms/src/web/authors.ts
  - packages/cms/src/web/feed-item.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/themes/default/README.md
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 104800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The andrewshell.org design (decision-16) reads four things the template context does not carry. siteAuthor: the profile behind the site author setting when it names a user, resolved the way a byline resolves a post author (name, username, url, bio, avatar, links), present on every render; on a post the entry author is the same object as author, on an author archive it is the archive user. summary: on every entry in a listing (home, posts page, tag, category, author, front page), the description the author wrote or else the excerpt the feeds already compute, plain text, so a feed item can print a p-summary. previous and next: on a post, the published post before and after it by date, each with title and url, absent at the ends. recentPosts: on the front page (the page the homepage setting names), the newest published posts, the posts of the current month when there are at least five of them and the five newest otherwise, the rule the source theme uses. The user profile also gains two optional text fields, job title and location, edited on the user profile screen and present on the author and siteAuthor objects, so the bio can print them and the JSON-LD Person can carry jobTitle and address. Document every key in themes/default/README.md as part of the context contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 siteAuthor is on the context of every rendered page, is the resolved profile when the site author setting names a user, is the post author on a post and the archive user on an author archive, and is absent when nobody matches; a test covers each
- [ ] #2 Every entry in every listing carries summary, the front-matter description or else the same excerpt the feeds print, and a post with neither has an empty summary rather than a missing key
- [ ] #3 A post carries previous and next with title and url for its neighbours by date among published posts, absent at either end; drafts and future posts are never neighbours
- [ ] #4 The front page context carries recentPosts by the current-month-or-five rule, and the home listing is unaffected
- [ ] #5 The user profile screen edits optional job title and location fields, they round-trip through the profile store, and author and siteAuthor expose them as jobTitle and location
- [ ] #6 themes/default/README.md documents siteAuthor, summary, previous, next, recentPosts, jobTitle and location as context keys
<!-- AC:END -->
