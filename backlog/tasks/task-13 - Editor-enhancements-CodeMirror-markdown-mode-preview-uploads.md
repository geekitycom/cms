---
id: TASK-13
title: 'Editor enhancements: CodeMirror markdown mode, preview, uploads'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-11
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Progressive enhancement of the editor textarea with CodeMirror 6 in markdown mode, a preview tab that POSTs the body to /admin/preview and renders it through the theme post template, and an upload endpoint that stores files under content/uploads/{yyyy}/{mm}/ and returns the Markdown image or link syntax to insert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The editor works without JavaScript and upgrades to CodeMirror when it loads
- [ ] #2 Preview renders the current unsaved body using the same Markdown pipeline as the public site
- [ ] #3 Uploading an image via the editor stores it under content/uploads and the returned path renders on the public site
- [ ] #4 Uploads reject files over a configurable size limit and disallowed types
<!-- AC:END -->
