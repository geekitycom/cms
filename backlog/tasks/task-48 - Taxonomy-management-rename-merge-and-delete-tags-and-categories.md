---
id: TASK-48
title: 'Taxonomy management: rename, merge, and delete tags and categories'
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - admin
  - content
milestone: m-5
dependencies:
  - TASK-35
  - TASK-36
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 27975
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once categories exist, the admin needs the WordPress taxonomy screens: `/admin/tags` and `/admin/categories` listing every term with its post count, and actions to rename a term, merge one into another, and delete one. The files are the truth (decision-1), so each action rewrites the front matter of every post carrying the term through the document writer, announces each change to the sync so the index, the feeds and federation (an `Update(Article)` per affected published post, since the Hashtags change) follow, and reports how many files it touched. A rename that would collide with an existing term is offered as a merge instead. Old archive URLs for a renamed term redirect to the new one for as long as the site records the rename (a small list in `site.json`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The tags and categories screens list every term with its post count and link to the archive
- [ ] #2 Rename rewrites every affected file, the archive moves, the old archive URL redirects, and each affected published post is delivered as Update(Article)
- [ ] #3 Merge moves every post from one term to another without duplicating the target on a post that had both
- [ ] #4 Delete removes the term from every file and the archive answers 404
- [ ] #5 Each action reports the number of files rewritten and is proved by tests over fixture posts
<!-- AC:END -->
