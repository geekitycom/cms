---
id: TASK-430
title: The metadata sweep panel moves from Media to Tools → Maintenance
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 23:26'
updated_date: '2026-10-19 23:43'
labels:
  - admin
dependencies: []
priority: medium
ordinal: 367800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The "Location and camera metadata" card takes half of /admin/media for a job most sites run once. Move the panel, its job status and its report to the Tools → Maintenance screen, and leave Media a one-line notice only while no sweep has finished.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tools → Maintenance shows the metadata sweep: what it does, its live status and its last report, and the button that queues it
- [x] #2 Queuing the sweep from either screen returns to Maintenance, where its progress shows
- [x] #3 Media shows a one-line notice with a button to run the sweep and a link to Maintenance until a sweep has finished, and nothing after that
- [x] #4 doc-5 describes where the sweep lives
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the strip-metadata POST route, job status and report into the Maintenance screen. 2. Media shows a one-line notice until the latest sweep has finished. 3. Repoint the privacy page link and docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: media-strip-metadata.test.ts now drives /admin/tools/maintenance and adds notice tests (shown with no sweep, no second button while queued, gone once finished); settings-privacy test checks the new link; full pnpm test passes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The metadata sweep card, its live status and its report moved to Tools > Maintenance, which now owns POST /admin/tools/maintenance/strip-metadata. Media keeps a one-line notice with Strip it now and a link to Maintenance until a sweep has finished. Verified with media-strip-metadata.test.ts and the full test run.
<!-- SECTION:FINAL_SUMMARY:END -->
