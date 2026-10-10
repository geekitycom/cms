---
id: TASK-323
title: 'Comments feeds: pages get one, and the README describes what they carry'
status: To Do
assignee: []
created_date: '2026-10-10 12:52'
updated_date: '2026-10-10 12:52'
labels:
  - comments
  - feeds
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/conversation.ts
  - packages/cms/README.md
priority: low
type: enhancement
ordinal: 282800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS README's comments feed section (packages/cms/README.md, around "This CMS stores no comments of its own") predates native comments and webmentions. It says the feeds carry only fediverse replies, but both feeds read the same ConversationReader as the thread (web/conversation.ts): native comments, webmention replies and mentions, and fediverse replies, without likes and reposts.

It also says a page has no comments feed because pages never federate (web/routes.ts, the comments route for a permalink). Pages accept comments since TASK-196, so that reason no longer holds: a page with a conversation should have a {permalink}feed/ like a post, and its comments should be in /comments/feed/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A published page that accepts comments answers {permalink}feed/ with an RSS comments feed of its conversation, empty when it has none; a page that does not accept comments 404s there as today
- [ ] #2 /comments/feed/ includes comments on pages, naming the page as it names a post
- [ ] #3 The page advertises its comments feed the way a post does
- [ ] #4 The README comments feed section describes what the feeds carry today: native comments, webmention replies and mentions, and fediverse replies, without likes and reposts, and that pages have one
<!-- AC:END -->
