---
id: TASK-196
title: Pages show and accept comments like posts
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
updated_date: '2026-10-01 17:04'
labels:
  - indieweb
  - webmention
  - theme
milestone: m-28
dependencies: []
references:
  - packages/cms/themes/default/layouts/page.njk
  - packages/cms/themes/default/partials/conversation.njk
priority: low
type: feature
ordinal: 212800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks to receive webmentions and display comments on every post type. Posts show the conversation (replies, likes, reposts, mentions, and fediverse responses), but pages rendered by layouts/page.njk show none, even when a webmention to a page has been received and accepted. Decide with the site owner's comments setting whether pages take part, then render the conversation partial on pages that accept comments, with the same moderation as posts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A page that accepts comments shows its accepted replies, likes, reposts and mentions with the same markup as a post
- [ ] #2 A webmention to a page is received, moderated and displayed the same way as one to a post
- [ ] #3 A page can turn comments off, and then shows none, as a post can
<!-- AC:END -->
