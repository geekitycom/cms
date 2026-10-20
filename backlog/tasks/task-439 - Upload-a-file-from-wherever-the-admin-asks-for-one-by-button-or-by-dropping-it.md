---
id: TASK-439
title: >-
  Upload a file from wherever the admin asks for one, by button or by dropping
  it
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-20 15:53'
labels:
  - admin
  - media
dependencies: []
priority: medium
ordinal: 376800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the only places to upload are the media library page and the post body editor. Choosing a photo for a photo post, a review item picture, a podcast recording or transcript, an alternate version, the site icon or a user avatar means leaving the post, uploading on the media page, copying the path and coming back. Every place the admin asks for a media file should take an upload in place: an Upload button, and dropping a file onto the field or onto the photo grid. The uploaded file goes through the same storeUpload rules and lands in the media library like any other upload.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The photo post's media library grid shows even when the library has no images, and dropping one or more image files onto it (or picking them with an Upload button) uploads each and adds it to the grid already ticked
- [ ] #2 The review item picture, transcript, alternate version address, site icon and user avatar fields each take an upload by button or drop, and the field's value becomes the uploaded file's /uploads/ address
- [ ] #3 The podcast recording select takes an upload by button or drop, and the uploaded file becomes a selected option
- [ ] #4 Dropping files onto the media library grid uploads them and shows them in the library without using the upload dropdown
- [ ] #5 A field that wants an image refuses a non-image upload on the server, and a refused upload shows its error beside the field without losing anything typed
- [ ] #6 Every page still works without JavaScript; the upload controls appear only when the script runs
- [ ] #7 Tests cover the image-only refusal and the markup each upload target renders
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One script admin/static/upload-drop.js reads data-upload-* attributes and posts to POST /admin/uploads (JSON); a table of target kinds (photos grid, text field, select, library) decides what a finished upload does.
2. /admin/uploads takes an optional field asking for images only, passed to storeUpload's imagesOnly.
3. Each template marks its target and renders a hidden upload control the script reveals; the photo grid renders even when empty.
4. Tailwind @source for the script; markup and refusal tests; verify in a browser.
<!-- SECTION:PLAN:END -->
