---
id: TASK-496
title: >-
  The editor offers unsaved changes back when it opens, and an Unsaved list
  resumes or discards them
status: To Do
assignee: []
created_date: '2026-10-23 10:50'
labels:
  - admin
  - editor
  - autosave
milestone: m-47
dependencies:
  - TASK-494
  - TASK-495
references:
  - packages/cms/src/admin/documents.ts
  - packages/cms/admin/pages/documents/conflict.njk
  - packages/cms/admin/pages/documents/editor.njk
ordinal: 421800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: a copy is only useful if the writer finds it. Opening a document with a newer copy (server or browser) shows a banner to Restore or Discard; a copy whose base has changed is shown beside the current version. The Posts and Pages lists gain an Unsaved filter so new documents never saved can be found, and resumed without JavaScript.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Opening the editor for a document with a server copy newer than the file shows an alert: Unsaved changes from <time>, with Restore and Discard; with no copy, or an older one, nothing is shown
- [ ] #2 Restore fills the title, body, editor and the other fields from the copy without saving; Discard deletes the copy (server and local) and leaves the form as loaded
- [ ] #3 When the copy base hash differs from the file hash, the banner says the post changed since, and Restore shows the copy beside the current version in the same layout as the conflict screen
- [ ] #4 The bundle also checks localStorage for a copy of this key and offers whichever of the server and local copies is newer
- [ ] #5 Posts and Pages lists have an Unsaved filter listing the user copies (title or first words, kind, saved time, new or existing), each with Resume and Discard; it works without JavaScript, Resume opening the editor with the copy fields filled in by the server
- [ ] #6 A new document copy resumes into /admin/{posts,pages}/new with its kind and autosave id, and saving it creates the document and deletes the copy
- [ ] #7 The banner and list meet the admin accessibility rules (alert role, labelled buttons, keyboard), and tests cover each case including a changed base and no-JS resume; docs/admin.md describes resuming
<!-- AC:END -->
