---
id: TASK-181
title: 'Post page ETags ignore new replies, likes and quotes'
status: To Do
assignee: []
created_date: '2026-09-29 02:30'
updated_date: '2026-09-29 23:01'
labels:
  - bug
  - web
milestone: m-20
dependencies: []
priority: medium
type: bug
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In production (watch off) the HTML representation of a post is served with Cache-Control no-cache and an ETag of representationEtag(representation, document.hash) (packages/cms/src/web/routes.ts, the validated branch near line 617). document.hash covers only the post file, but the page also renders its conversation: fediverse replies, native comments, webmentions, likes, boosts and, since TASK-171, approved quotes. When one of those arrives, a browser revalidating the page sends If-None-Match, gets 304, and keeps showing the old conversation until a hard reload; a shared cache does the same for everybody. The .md and .json representations do not render the conversation and are unaffected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post page's validator changes when anything its conversation shows changes: a reply, like, boost, mention or quote arriving, being approved, withdrawn or deleted
- [ ] #2 A conditional GET after a new reply returns 200 with the reply, and one with nothing new still returns 304, proven by tests
- [ ] #3 Last-Modified agrees with the ETag (the later of the post's and its conversation's last change), or is omitted
- [ ] #4 Computing the validator adds no per-request file reads beyond what rendering the conversation already does
<!-- AC:END -->
