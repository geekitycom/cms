---
id: TASK-414
title: 'A derived image of an upload that is not an image answers 404, not 500'
status: To Do
assignee: []
created_date: '2026-10-15 01:16'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/src/web/asset-routes.ts
  - packages/cms/src/images/variants.ts
priority: low
type: bug
ordinal: 369800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A request under /uploads/_/ for a derived variant (packages/cms/src/web/asset-routes.ts imageVariant, images/variants.ts) whose source upload exists but is not an image sharp can read answers 500 with 'Input file contains unsupported image format'. Found while building TASK-377. A variant of a source that cannot be resized is a missing resource, not a server error, and should answer 404 without logging an error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A variant request whose source is not a readable image answers 404 and logs no error; a test proves it
- [ ] #2 A variant of a real image is served as today
<!-- AC:END -->
