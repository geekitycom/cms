---
id: TASK-378
title: Uploaded PDFs are served as application/pdf
status: To Do
assignee: []
created_date: '2026-10-13 02:38'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/files/static-files.ts
  - packages/cms/src/content/media.ts
priority: medium
ordinal: 337800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org migration (v0.31.0). Every PDF under content/uploads is served as Content-Type: application/octet-stream, so a browser downloads it instead of showing it. That includes Andrew's resume, /uploads/2026/03/resume.pdf, which prod WordPress serves as application/pdf (opened inline). The upload route takes its type from CONTENT_TYPES in files/static-files.ts (line ~102, falling back to application/octet-stream), and that table has no .pdf. content/media.ts accepts .pdf uploads as a document kind, so the two tables disagree about the same files. On this site every other upload type in use (png, jpg, gif, webp, mp3) is served correctly. Proposal: serve each upload with the type of its kind in media.ts's table, so any type the site accepts is served as what it is. Or, at least, add .pdf → application/pdf and check every accepted extension against the served type.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An uploaded .pdf is served with Content-Type: application/pdf
- [ ] #2 Every extension media.ts accepts is served with a specific type, not application/octet-stream; a test pins the two tables together
- [ ] #3 On andrewshell.org, /uploads/2026/03/resume.pdf opens in the browser, as it does on WordPress today
<!-- AC:END -->
