---
id: TASK-353
title: Each post field is described once
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-33
dependencies:
  - TASK-352
type: chore
ordinal: 312800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adding a post field means editing formFor and resolveExtra (admin documents), createForm (micropub/create.ts), sourceProperties and UPDATABLE_BY_TYPE (micropub/update.ts). documents.ts branches on kind.type === post 25 times although DocumentKind already carries capability flags.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extra-backed post fields are declared in one table that drives form-from-document, document-from-form and the Micropub property mapping in both directions
- [ ] #2 Post-only behaviour is a capability of the document kind; no kind.type === post checks remain in the write path or form conversion
- [ ] #3 A test adds a field to the table alone and sees it round-trip through the editor form and Micropub
- [ ] #4 Micropub create, update and q=source output is unchanged for every existing field
<!-- AC:END -->
