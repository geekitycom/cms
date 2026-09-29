---
id: TASK-165
title: 'Micropub media endpoint: upload into the media library'
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - media
milestone: m-25
dependencies:
  - TASK-163
references:
  - 'https://www.w3.org/TR/micropub/#media-endpoint'
  - packages/cms/src/admin/uploads.ts
priority: medium
type: feature
ordinal: 189800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clients upload a photo first and then reference its URL in a post. A multipart POST with a file part stores it in the media library through the same path the admin upload uses (decision-10: the original under content/uploads, variants derived), with the same size and type limits, and answers 201 with the file's URL. Advertised as media-endpoint in q=config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A multipart upload returns 201 with a Location the file is served at, and the file appears in the admin media library
- [ ] #2 Uploads over the admin limit or of a type the media library refuses get 400, and nothing is stored
- [ ] #3 A token without the media scope gets 403 insufficient_scope
- [ ] #4 GET ?q=last returns the URL of the most recent upload by the token's user
- [ ] #5 q=config names the media endpoint
<!-- AC:END -->
