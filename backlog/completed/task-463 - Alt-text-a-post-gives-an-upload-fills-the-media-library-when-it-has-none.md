---
id: TASK-463
title: Alt text a post gives an upload fills the media library when it has none
status: Done
assignee: []
created_date: '2026-10-21 00:48'
updated_date: '2026-10-22 13:52'
labels:
  - media
  - editor
dependencies: []
ordinal: 396800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a post describes an upload (a photo's alt, or the alt of an image in the body) and the media library has no alt text for that upload, saving the post writes the post's text into content/_data/media.json. The library is never overwritten: an entry that is already described or marked decorative stays as it is. A photo uploaded from the editor is then described in Media, and the next post that uses it is offered that text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Saving a post whose photo has alt text writes it to the library for an upload with no entry
- [x] #2 An image in the body with alt text does the same
- [x] #3 A described or decorative library entry is never changed by a post save
- [x] #4 Images that are not uploads, or have empty alt, write nothing
- [x] #5 Micropub posts take the same path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
After writeDocument saves the file, fillAltTexts collects the post's photo alts and body image alts for uploads, skips any the library already has (described or decorative), and writes the rest in one atomic update that rechecks the file.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared write path, so the editor and Micropub both fill the library. Verified by new cases in src/admin/alt-text.test.ts (photo, body image, never overwrite described/decorative, nothing for non-uploads or empty alt) and a library assertion on the Micropub { value, alt } test. Full cms suite 6340/6340.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in cms 0.37.0 (ddf1966). Saving a post, from the editor or Micropub, writes the alt text it gives an upload into media.json when the library has none; described or decorative entries are never changed.
<!-- SECTION:FINAL_SUMMARY:END -->
