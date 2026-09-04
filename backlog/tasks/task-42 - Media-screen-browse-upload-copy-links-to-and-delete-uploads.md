---
id: TASK-42
title: 'Media screen: browse, upload, copy links to, and delete uploads'
status: To Do
assignee: []
created_date: '2026-09-04 01:14'
labels:
  - admin
milestone: m-6
dependencies:
  - TASK-13
  - TASK-28
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Uploads work from the editor ("Add file…" and drag-and-drop, TASK-13) and from the avatar panel (TASK-28), but nothing lists what has been uploaded, so a file uploaded last month cannot be found, linked again, replaced or removed. Add `/admin/media` as a section in the admin navigation: a grid or table of everything under `content/uploads/` newest first (thumbnail for images, an icon and size for the rest), the public URL with a copy control and the ready-made Markdown for it, the upload date, and which published or draft documents reference it (a search of the index for the path). An upload form on the screen uses the shared `storeUpload` helper, so the rules are the ones the editor enforces. Delete removes the file and, once the image optimization task exists, its variants; a file that a document still references asks for confirmation naming the documents. The screen reads the directory itself rather than a table, since the filesystem is the truth (decision-1, decision-9); a small index for reference counts is acceptable as a cache. Paging or a month filter keeps a large library usable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /admin/media lists every file under content/uploads newest first with thumbnail or icon, size, date and public URL, and appears in the admin navigation
- [ ] #2 Each entry offers the public URL and the Markdown for it in a copyable form, and links to the documents that reference it
- [ ] #3 Uploading from the screen stores the file exactly as the editor upload does and it appears in the list
- [ ] #4 Deleting a file that no document references removes it from disk; deleting one that is referenced first names the documents and asks for confirmation
- [ ] #5 A file dropped into content/uploads by hand appears in the list without a restart
- [ ] #6 The screen works without JavaScript; the copy control is an enhancement
<!-- AC:END -->
