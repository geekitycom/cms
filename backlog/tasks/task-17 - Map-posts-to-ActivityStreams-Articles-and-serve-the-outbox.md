---
id: TASK-17
title: Map posts to ActivityStreams Articles and serve the outbox
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-16
  - TASK-6
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Object dispatcher for /ap/posts/{slug} returning an Article per doc-4 (id, url, name, content, source markdown, published, updated, attributedTo, to Public, cc followers, Hashtag tags). Outbox collection pages over published posts as Create activities. The post HTML page links to its ActivityStreams id with rel=alternate, and a post permalink requested with an ActivityStreams Accept header is answered by Fedify.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /ap/posts/{slug} with an ActivityStreams Accept returns an Article whose content equals the rendered HTML and whose source is the Markdown
- [ ] #2 Drafts and pages are not dispatched as objects
- [ ] #3 The outbox lists Create(Article) activities newest first with paging
- [ ] #4 The HTML post page contains a link rel=alternate type=application/activity+json to the object id
<!-- AC:END -->
