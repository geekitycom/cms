---
id: TASK-245
title: Collapse the post editor's unused blocks and group its sidebar
status: To Do
assignee: []
created_date: '2026-10-03 16:52'
labels:
  - admin
  - accessibility
dependencies: []
references:
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/admin/static/admin.css
priority: medium
type: enhancement
ordinal: 260800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The post editor (packages/cms/admin/pages/documents/editor.njk) shows every block at full size: in the main column Photos (with an empty 'Add a photo' row), Location (six boxes) and Recording (with 'Other versions' and an empty 'Add a version' row); in the side column about twenty fields in one flat list (Slug, Permalink, Date, Tags, Categories, In reply to, Like of, Repost of, Bookmark of, Read, Description, Language, Author, Draft, Visibility, Pinned, Syndicate to, Comments, Hide from collections, Contact form). Most posts use few of them, so the page is mostly empty boxes.

Use native <details>/<summary> so it works without JavaScript and stays keyboard and screen-reader accessible (the accessible-by-default milestone). A block or group is open when any field in it has a value or a validation error, and collapsed when it is empty, so nothing filled in is ever hidden and an error-summary link always lands on a visible field. Proposed sidebar groups: Publishing (Draft, Date, Visibility, Pinned, Author; open by default), Tags and categories (open by default), Address (Slug, Permalink), Responding to (In reply to, Like of, Repost of, Bookmark of), Read, Summary and language (Description, Language), Syndicate to, Display and discussion (Comments, Hide from collections, Contact form). Pages show only the groups that apply to them. The Read status option 'Not a read' becomes 'Not a read post'; the others stay Want to read, Reading, Finished.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Photos, Location and Recording (and Recording's Other versions, and each empty Add a photo / Add a version row) are collapsed when empty and open when any field in them has a value
- [ ] #2 The sidebar fields are grouped as described, each group collapsed when empty except Publishing and Tags and categories, which start open
- [ ] #3 A save refused with a field error re-renders with that field's block or group open, and the error summary link reaches it
- [ ] #4 Everything works without JavaScript; summaries are reachable and operable by keyboard and announce their open state (native details/summary)
- [ ] #5 The Read status option reads 'Not a read post'
- [ ] #6 Existing editor tests pass; new tests cover open/closed state for an empty post, a filled post and a refused save; styles.test.ts covers any new classes
<!-- AC:END -->
