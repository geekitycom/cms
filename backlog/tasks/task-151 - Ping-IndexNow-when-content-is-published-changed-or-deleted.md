---
id: TASK-151
title: 'Ping IndexNow when content is published, changed or deleted'
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/seo/indexnow/'
priority: low
type: feature
ordinal: 175800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS already pings WebSub and rssCloud when posts change. IndexNow gets the same URLs recrawled by Bing, Yandex, Naver and Seznam within minutes. It needs a key file served at the site root.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site can turn IndexNow on; a key is generated, stored in the site's files, and served at /{key}.txt
- [ ] #2 Publishing, updating or deleting a post or page submits the affected URLs through the existing background-job path, batched and retried
- [ ] #3 Nothing is sent for drafts, or when the base URL is not public
<!-- AC:END -->
