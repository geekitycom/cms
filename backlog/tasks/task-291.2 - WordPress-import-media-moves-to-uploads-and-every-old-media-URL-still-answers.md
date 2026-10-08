---
id: TASK-291.2
title: >-
  WordPress import: media moves to /uploads/ and every old media URL still
  answers
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
updated_date: '2026-10-08 11:51'
labels: []
milestone: m-31
dependencies:
  - TASK-282
parent_task_id: TASK-291
ordinal: 249800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress export lists attachments but carries none of the files, and post bodies point at https://<site>/wp-content/uploads/... (often on a staging host the site was built on, and often at a -1024x575 size variant). The import copies the original of each attachment from a local copy of wp-content/uploads into content/uploads/, points every body at the original, keeps alt text, and keeps old media URLs answering for links from elsewhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity import wordpress takes an uploads directory option; each attachment original is copied to content/uploads/ at its YYYY/MM/ path
- [ ] #2 WordPress size variants (-WxH, -scaled) are not copied; a body or link that points at a variant is pointed at the original, since Geekity makes its own variants
- [ ] #3 Body URLs on the site origin or on any extra origin given as an option (a staging host) are rewritten to /uploads/... root-relative paths
- [ ] #4 _wp_attachment_image_alt is written to _data/media.json
- [ ] #5 A request for /wp-content/uploads/<path> answers 301 at the /uploads/ URL of the same file, or of its original for a size variant, without one redirects.json entry per file
- [ ] #6 A referenced file missing from the uploads directory, or one over the upload limits or of a refused type, is named in the report
<!-- AC:END -->
