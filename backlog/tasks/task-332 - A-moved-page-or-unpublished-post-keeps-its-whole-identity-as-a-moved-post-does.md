---
id: TASK-332
title: >-
  A moved page or unpublished post keeps its whole identity, as a moved post
  does
status: To Do
assignee: []
created_date: '2026-10-10 18:27'
labels:
  - comments
  - federation
dependencies:
  - TASK-329
references:
  - packages/cms/src/comments/records.ts
priority: low
type: bug
ordinal: 291800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-329 made comments follow a document whose slug changes when it leaves redirect_from. Gaps it inferred from the code but did not reproduce: the editor keeps the old URL as activitypub.id only for posts, so a moved page's /replies/{key}/ and a reply post to its old URL break; the editor writes no redirect_from for a post moved while unpublished, so its comments do not follow; a hand permalink change without redirect_from cannot be linked back to its comments; webmentions_sent rows stay keyed by the old slug; and during a watcher burst (a git pull) that adds a new post at the old URL right after a move, the moved post could take that post's comments, which a full scan does not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each listed gap is reproduced or ruled out, with findings in the notes
- [ ] #2 A moved page keeps its /replies/ feed and its reply posts as a moved post does
- [ ] #3 A post moved while unpublished keeps its comments once published
- [ ] #4 A watcher burst that moves a post and adds another at its old URL gives each post its own comments, as a full scan does
- [ ] #5 webmentions_sent follows a moved document, so it is not re-sent or orphaned
<!-- AC:END -->
