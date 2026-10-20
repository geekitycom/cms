---
id: TASK-437
title: >-
  The media library counts a file as used when front matter or site settings
  point at it
status: To Do
assignee: []
created_date: '2026-10-20 14:04'
labels:
  - admin
  - media
dependencies: []
references:
  - packages/cms/src/admin/media.ts
  - packages/cms/src/media/library.ts
priority: high
type: bug
ordinal: 374800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me the media library badges every file "Unused", including a review poster and book covers that published reviews show, and the site icon. The library only counts a document whose body mentions the upload (`mentionsUpload(document.body, url)` in packages/cms/src/admin/media.ts). Front matter (photo posts' `photo` list, a review's `item.photo`, `featured`/cover images, any other front-matter value naming an upload) and site-level uses (the site icon, user avatars and any other setting that stores an upload path) are never looked at. So the "Unused" badge and filter are wrong. Worse, Delete skips its "this file is still used" confirmation for files that are in use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A file named by any front-matter value of a live or trashed document (photo list, review item picture, cover, nested values) is listed as used by that document
- [ ] #2 A file used by the site itself (the site icon, a user avatar, any setting that stores an upload) is listed as used, saying by what, with a link to where it is set
- [ ] #3 The Unused badge and the Not used anywhere filter follow the same answer
- [ ] #4 Deleting a file used only through front matter or a setting asks for confirmation as a body reference does
- [ ] #5 A file that nothing uses is still Unused
<!-- AC:END -->
