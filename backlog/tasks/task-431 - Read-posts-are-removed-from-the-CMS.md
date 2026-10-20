---
id: TASK-431
title: Read posts are removed from the CMS
status: To Do
assignee: []
created_date: '2026-10-20 01:15'
labels:
  - content
  - micropub
milestone: m-40
dependencies: []
references:
  - packages/cms/src/content/read.ts
  - packages/cms/src/content/read-form.ts
  - packages/cms/src/micropub/indiebookclub.test.ts
  - docs/micropub.md
priority: medium
ordinal: 368800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Read posts (`read-of`, `read-status`) are being replaced by reviews: logging a book through Want to read, Reading and Finished as linked posts was judged too complicated, and a Book review covers what the site needs. No production site has read posts and indiebookclub is not in use, so remove the support outright instead of hiding it. This is a breaking change; the package is 0.x, so it lands as a `feat!` commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The editor has no Read section and no read fields
- [ ] #2 Post type discovery no longer reports a read; a post with `read-of` is discovered as whatever its other properties make it
- [ ] #3 A Micropub create or update with `read-of` or `read-status` treats them like any other property the CMS does not recognize, and `q=source` and the fields list no longer describe them
- [ ] #4 Templates, the read summary line, feeds and federation no longer render read-specific output
- [ ] #5 The read code, its form handling and its tests (including the indiebookclub replay) are deleted, not left unused
- [ ] #6 docs/micropub.md and any other docs no longer describe read posts
- [ ] #7 The commit that removes them is marked breaking (`feat!` or a BREAKING CHANGE footer)
<!-- AC:END -->
