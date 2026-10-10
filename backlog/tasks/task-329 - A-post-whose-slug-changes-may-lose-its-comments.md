---
id: TASK-329
title: A post whose slug changes may lose its comments
status: To Do
assignee: []
created_date: '2026-10-10 16:57'
labels:
  - comments
dependencies: []
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/admin/store.ts
priority: medium
type: bug
ordinal: 288800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen while building TASK-327, not yet reproduced on purpose: after a post on a scratch site was moved, its comments dropped out of the thread and /replies/{commentId}/ 404ed. Threads read comments by slug (listCommentsFor(document.slug), web/conversation.ts; comments are stored per slug in content/_data/comments/{slug}.json), so a permalink change alone should keep them, but renaming the file (which changes the slug) would leave the comments under the old slug. Webmentions, reply posts and fediverse replies are keyed differently (target URL, in-reply-to, object id) and may or may not follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The behaviour is reproduced or ruled out for each of: a permalink change, a file rename that changes the slug, and a move to another directory; findings recorded in the notes
- [ ] #2 If comments are lost on any of them, they follow the post: native comments, webmentions, reply posts and fediverse replies stay in its thread, its feeds and their /comment/ and /replies/ pages, without a manual step
- [ ] #3 A test covers each case that was broken
<!-- AC:END -->
