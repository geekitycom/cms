---
id: TASK-429
title: Media library is a thumbnail grid with filters and a details screen per file
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 23:26'
updated_date: '2026-10-19 23:43'
labels:
  - admin
dependencies: []
priority: medium
ordinal: 366800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The media screen at /admin/media is a table of tiny thumbnails with an alt-text form, two copy fields, a references list and a delete button on every row, which is hard to scan. Replace it with the grid chosen from the mockups in _local/media-mockups (option A): large square tiles, filters above them, and every per-file control on one details screen. The screen keeps working with JavaScript switched off; a script may open the details in a dialog and step through files with the arrow keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The library shows files as a grid of square tiles: an image as a thumbnail, any other file as its kind and extension, with the file name under it
- [x] #2 A tile is badged "No alt text" when it is an image with no alt text, and "Unused" when no document, live or trashed, mentions it
- [x] #3 Kind tabs (All, Images, Audio, Video, Documents) carry counts, and a GET form filters by name or alt text, by needs-alt-text, by not-used-anywhere and sorts by newest, oldest, largest or name; the filters survive paging
- [x] #4 Each tile links to a details screen for that file: preview, uploaded date, size, path, the alt-text form (images), URL and Markdown copy fields, what uses it, and Delete, with previous and next links through the current filtered list
- [x] #5 Saving alt text and the delete confirmation land on the details screen; deleting returns to the library
- [x] #6 Upload sits behind an Upload button above the grid and still works without JavaScript
- [x] #7 With JavaScript on, clicking a tile opens its details in a dialog, and the left and right arrow keys move to the previous and next file
- [x] #8 doc-5 describes the new screen
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Library route builds a MediaView from the query (kind, q, alt=missing, unused=1, sort, page) and renders a tile grid with kind tabs and a GET filter form. 2. New /admin/media/file details screen with prev/next through the view; alt and delete forms carry the view in a hidden from field. 3. static/media.js opens details in a dialog and steps with arrow keys; copy.js enhances inserted content. 4. Tests for filters, details, navigation; doc-5 and docs/media.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
References are computed once per request from one listAll pair, then matched per file, so the Unused filter covers the whole library. Thumbnails use the narrowest variant >=400px in the first configured format, else the original. The dialog parses the fetched page in a <template> so the other page's nonced <style> is not checked against this page's CSP (DOMParser raised a console CSP error). Tailwind now scans static/media.js for the modal classes. A delete of a referenced file that the library does not list (e.g. a .geekity-strip leftover) is refused instead of deleted unasked.

Validation: pnpm test 6282/6282, pnpm lint clean, tsc clean. Browser check against a local site (Playwright, Chromium): grid renders, tile opens the dialog, ArrowRight moves photo-1 -> photo-2, copy buttons revealed in the dialog, no console errors, no horizontal scroll at 390px.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The media library is a grid of square tiles with No alt text and Unused badges, kind tabs with counts, and a GET filter form (search, needs alt text, unused, sort) that pages keep. Each tile links to /admin/media/file, which holds the preview, alt-text form, copy fields, references and Delete, with Previous/Next through the view; media.js shows it in a dialog with arrow-key stepping. Verified with media.test.ts (filters, details, navigation, delete confirmation, JS-off markup), the full pnpm test run, and a Playwright check in Chromium.
<!-- SECTION:FINAL_SUMMARY:END -->
