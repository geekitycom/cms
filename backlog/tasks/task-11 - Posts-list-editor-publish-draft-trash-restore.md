---
id: TASK-11
title: 'Posts: list, editor, publish, draft, trash, restore'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-10
  - TASK-4
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core editing loop. List at /admin/posts with status filters and row actions. Editor at /admin/posts/new and /admin/posts/{slug} with title, slug (auto from title until touched), permalink preview, date, tags, description, draft checkbox, and body textarea. Save writes the Markdown file via the writer, then upserts the index. The form carries the file hash it loaded with; mismatch returns a conflict view. Trash moves the file to content/_trash; restore moves it back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Creating a post writes content/posts/{yyyy}-{mm}-{dd}-{slug}.md with explicit permalink and the post appears on the public site immediately
- [ ] #2 Editing the body and saving updates the file and the public page without restart
- [ ] #3 Saving with a stale hash returns a conflict view showing both versions and does not overwrite the file
- [ ] #4 Move to trash relocates the file to content/_trash and removes it from the public site; Restore reverses it
- [ ] #5 Toggling draft on and off is reflected in front matter and in public visibility
- [ ] #6 Unknown front-matter keys added by hand survive an admin save
<!-- AC:END -->
