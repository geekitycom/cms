---
id: TASK-327
title: 'A /replies/{key}/ request finds its item without scanning the whole site'
status: To Do
assignee: []
created_date: '2026-10-10 15:07'
labels:
  - feeds
  - performance
dependencies:
  - TASK-324
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/web/routes.ts
priority: low
type: enhancement
ordinal: 286800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-324 (decision-48) resolves /replies/{key}/, where key is the first 16 hex digits of sha256 of an item's feed guid, by scanning every served document, stored comment, logged fediverse reply and reply post per request. The URL is public, so anyone can make the site do that scan as often as they like with made-up keys, and the cost grows with the site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resolving a /replies/{key}/ looks the key up in an index rather than scanning documents and reply records
- [ ] #2 The index stays correct as documents, comments, webmentions, fediverse replies and reply posts are added, edited, moved or removed, and after a restart
- [ ] #3 An unknown key answers 404 without touching more than the index
- [ ] #4 A test shows the lookup still finds a post, a page, a native comment by key, a webmention, a fediverse note and a reply post
<!-- AC:END -->
