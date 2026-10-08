---
id: TASK-300
title: The owner's reply to a comment can also be published as a reply post
status: To Do
assignee: []
created_date: '2026-10-08 14:39'
labels: []
dependencies: []
references:
  - packages/cms/src/comments/submission.ts
  - packages/cms/src/comments/form.ts
  - packages/cms/src/comments/signed-in.test.ts
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
priority: medium
type: feature
ordinal: 260800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the signed-in site owner replies to a comment on a post or page, the reply today lives only in that comment thread. Add a checkbox to the comment form, shown only to the signed-in owner, that also publishes the reply as a reply post: a post with in-reply-to pointing at the comment, so it appears on the homepage, in the feeds, and federates like any other reply post. This lets the owner join a conversation on their own site and have it show up in their stream without writing the reply twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The comment form shows a "Also publish as a reply post" checkbox only to the signed-in owner; anonymous and other visitors never see it, and a forged field from them is ignored
- [ ] #2 Submitting a reply with the box checked creates the comment as today and also a reply post whose in-reply-to is the comment it answers (its URL on the page), with the same body
- [ ] #3 The reply post appears on the homepage and in the Atom, RSS and JSON feeds like any other reply post, and federates and sends webmentions through the usual reply-post paths
- [ ] #4 The comment and the reply post are linked so neither is shown twice to readers of the thread (decide and document whether the thread shows the comment, the post, or one pointing at the other)
- [ ] #5 With the box unchecked, behaviour is unchanged: only the comment is created
- [ ] #6 Tests cover the owner-only checkbox, the forged-field case, and the post that results; doc-6 Native Comments describes the option
<!-- AC:END -->
