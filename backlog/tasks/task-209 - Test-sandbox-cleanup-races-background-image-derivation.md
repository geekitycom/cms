---
id: TASK-209
title: Test sandbox cleanup races background image derivation
status: To Do
assignee: []
created_date: '2026-10-01 17:53'
labels:
  - tests
  - media
dependencies: []
references:
  - packages/cms/src/content/media.ts
priority: low
type: bug
ordinal: 225800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-204: a test that writes an upload file into a sandbox site but never fetches it starts background image-variant derivation, which can still be writing when the sandbox is removed, so cleanup fails with ENOTEMPTY and the test run fails intermittently. TASK-205 and TASK-207 worked around it by calling generateImageVariants after writing an upload. Fix it at the root: the sandbox (or the CMS's close()) should wait for, or cancel, pending derivation before the directory is removed, so a test cannot fail this way however it writes uploads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test that writes an upload and never fetches it passes reliably under repeated runs (for example 50 runs of that file)
- [ ] #2 cms.close() or the test sandbox waits for or cancels pending image derivation before files are removed
- [ ] #3 The generateImageVariants workaround is no longer needed in tests that only used it to avoid the race
<!-- AC:END -->
