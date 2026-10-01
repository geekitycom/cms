---
id: TASK-199
title: Reply context shows the cited author's photo
status: To Do
assignee: []
created_date: '2026-10-01 17:02'
labels:
  - indieweb
  - webmention
  - theme
dependencies: []
references:
  - packages/cms/src/webmention/reply-context.ts
  - packages/cms/themes/default/partials/reply-context.njk
priority: low
type: enhancement
ordinal: 215800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks for full rich reply-contexts: author name, image and a content summary. The reply context (built in TASK-123) has the cited post's name, author name and URL, date and excerpt, but no author photo. Read the author's u-photo from the cited h-entry's p-author h-card (falling back to the page's representative h-card), store it with the reply context, and show it in the default theme. Fetch the image server-side and store it locally or inline it rather than hotlinking, so a reader's browser is not sent to the cited site, the same reasoning as the IndieAuth consent logo (TASK-190).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reply to a post whose author h-card has a u-photo shows that photo beside the author's name in the reply context
- [ ] #2 The photo is served from the site (cached or inlined), never hotlinked, and is bounded in size and type
- [ ] #3 A cited post with no author photo shows the reply context as it does today
<!-- AC:END -->
