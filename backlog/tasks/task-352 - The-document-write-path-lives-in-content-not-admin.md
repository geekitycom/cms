---
id: TASK-352
title: 'The document write path lives in content, not admin'
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-33
dependencies:
  - TASK-351
type: chore
ordinal: 311800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Micropub imports writeDocument, formFor, blankForm, POST_KIND, moveDocumentFile and EditorForm from admin/documents.ts (2275 lines). The shared write path for every authoring input sits in an admin screen module. writeDocument (about 280 lines) mixes validation, slug and permalink resolution, conflict checks, file move, sidecar moves and announce.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 writeDocument, the document form type, form conversion, document kinds and move/trash live under content/; admin/documents.ts keeps routes and rendering
- [ ] #2 No module under micropub/ imports from admin/
- [ ] #3 writeDocument is split into validation, identity (slug and permalink) and persistence steps, and the rename-with-rollback stays one unit
- [ ] #4 Existing admin and Micropub tests pass unchanged in behaviour
<!-- AC:END -->
