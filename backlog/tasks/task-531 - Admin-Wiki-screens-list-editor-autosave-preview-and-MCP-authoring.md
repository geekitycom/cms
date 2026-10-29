---
id: TASK-531
title: 'Admin Wiki screens: list, editor, autosave, preview and MCP authoring'
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-530
references:
  - decision-66
ordinal: 433800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: the operator writes wiki pages in the admin like posts and pages. /admin/posts and /admin/pages are both mountDocumentScreens with a different DocumentKind (src/admin/documents.ts); several admin paths still branch on post vs page with a ternary (editor-actions, autosave, preview, comments, media editUrl) and need a third case.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Wiki entry in the admin sidebar opens /admin/wiki: a list of wiki pages with drafts and trash, and new/edit screens using the wiki kind (title, slug, body; no date, tags, categories, reply or location fields)
- [ ] #2 `/admin/wiki/new?slug=…&title=…` opens the editor with those filled in
- [ ] #3 Autosave, preview, editor actions and links from the comments and media screens work for wiki pages
- [ ] #4 The dashboard content counts include wiki pages
- [ ] #5 The MCP authoring tools can create, read and update wiki pages; Micropub is unchanged
<!-- AC:END -->
