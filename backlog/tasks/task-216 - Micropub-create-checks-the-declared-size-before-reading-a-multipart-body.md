---
id: TASK-216
title: Micropub create checks the declared size before reading a multipart body
status: To Do
assignee: []
created_date: '2026-10-02 16:22'
labels:
  - micropub
dependencies: []
priority: low
type: bug
ordinal: 232800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The media endpoint (packages/cms/src/micropub/media.ts) refuses a request whose Content-Length exceeds the largest upload limit before the bearer guard reads the body. The create endpoint (POST /_geekity/micropub, packages/cms/src/micropub/endpoint.ts), which accepts photo file parts since TASK-166, reads a multipart body in full with no such check, so an oversized request is buffered before it is refused. Found while building TASK-166.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An oversized multipart create is refused with 413 or 400 before its body is read
- [ ] #2 A test proves the refusal without buffering the body
<!-- AC:END -->
