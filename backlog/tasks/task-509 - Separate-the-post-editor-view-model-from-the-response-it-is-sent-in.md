---
id: TASK-509
title: Separate the post editor view model from the response it is sent in
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 420800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/admin/documents.ts:957 renderEditor (~160 lines) builds editor actions, the resume offer and a ~60-key template model, and sets c.status and headers halfway through. mountDocumentScreens (documents.ts:231) has the restore-or-conflict decision inline in the GET /:slug handler. submittedForm repeats stringOrEmpty(body[x]).trim() about 13 times.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Building the editor model is a pure function that does not touch the response; status and headers are applied in one place
- [ ] #2 The restore-or-conflict decision and the editor action list are named functions
- [ ] #3 Form fields are read through one trimming helper
- [ ] #4 Editor screens behave the same: admin document and post tests pass without changes to their assertions
<!-- AC:END -->
