---
id: TASK-141
title: Alt text as a first-class field in the media library
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - accessibility
  - media
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/image-alt-text/'
priority: high
type: feature
ordinal: 165800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The media library has no alt-text field. When an upload is inserted, the file name is offered as its label (src/admin/uploads.ts), so images end up with alt text such as IMG_2034.jpg or with none. Alt text should be stored with the media item, offered by default when the image is inserted, and checked before publishing. Its absence should be treated as a problem to fix, while decorative images remain possible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each media item has an alt-text field that is stored in its file (decision-9) and editable in the media library
- [ ] #2 Inserting an image into a post uses the item's alt text, never the file name
- [ ] #3 An image can be marked decorative, which renders alt=""
- [ ] #4 Publishing a post with an image whose alt is missing shows a warning that names the image; a site can make this block publishing
- [ ] #5 Federated attachments carry the alt text as their name
<!-- AC:END -->
