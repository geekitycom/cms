---
id: TASK-413
title: 'An export does not carry its own job, and import leaves lost+found alone'
status: To Do
assignee: []
created_date: '2026-10-14 19:08'
labels: []
milestone: m-38
dependencies:
  - TASK-408
  - TASK-412
references:
  - packages/cms/src/export/export-job.ts
  - packages/cms/src/export/site-export.ts
  - packages/cms/src/export/site-import.ts
priority: low
type: bug
ordinal: 368800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two edge cases from the site export run. (1) An admin export (TASK-408, packages/cms/src/export/export-job.ts) runs as a site.export job, so the jobs.json it archives records that job as running; after geekity import, start-up recovery runs the export again on the new host and writes an unwanted archive. The archived jobs.json should not carry the export's own job (or any site.export job). (2) geekity import (TASK-412, packages/cms/src/export/site-import.ts) moves every entry it does not own aside with --replace and reads every entry when checking a target; a target that is the root of a filesystem can hold lost+found owned by root, which it cannot move or read. Import should leave lost+found where it is, and export should not carry it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The jobs.json in an archive written by the admin export holds no site.export job, and importing it runs no export; a test proves it
- [ ] #2 geekity import with --replace into a target holding lost+found leaves lost+found in place and restores the site; a test proves it
- [ ] #3 geekity export does not carry a lost+found folder
<!-- AC:END -->
