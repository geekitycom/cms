---
id: TASK-134
title: Proxy remote avatars so readers' IP addresses are not sent to other servers
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - privacy
  - federation
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/third-party-scripts/'
  - 'https://specification.website/spec/privacy/data-minimization/'
priority: medium
type: enhancement
ordinal: 158800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Avatars of fediverse and webmention participants are hotlinked from remote servers (themes/default partials/conversation.njk). Every reader who opens a post with replies sends their IP address and user agent to each of those servers. The site ships no other third-party requests, so this is the one leak. Fetching, resizing and caching avatars locally closes it and also makes pages faster.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Public pages reference remote avatars only through a same-origin URL
- [ ] #2 The proxy fetches only avatar URLs the site has recorded (it is not an open proxy), limits size and content type, and resizes to the size the theme displays
- [ ] #3 Cached avatars are refreshed on a schedule and a failed fetch falls back to a local placeholder
- [ ] #4 The cache is disposable: deleting it loses nothing that cannot be refetched (decision-9)
<!-- AC:END -->
