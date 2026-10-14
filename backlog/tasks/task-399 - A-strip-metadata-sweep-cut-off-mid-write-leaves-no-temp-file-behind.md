---
id: TASK-399
title: A strip-metadata sweep cut off mid-write leaves no temp file behind
status: To Do
assignee: []
created_date: '2026-10-14 11:20'
labels: []
milestone: m-38
dependencies:
  - TASK-392
references:
  - packages/cms/src/content/metadata/sweep.ts
  - packages/cms/src/admin/media.ts
priority: low
type: bug
ordinal: 355800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The metadata sweep (packages/cms/src/content/metadata/sweep.ts) replaces an upload by writing <file>.geekity-strip and renaming it over the original. Since TASK-392 the sweep runs as a queued job that can be killed or cut off, and a process killed between the write and the rename leaves the .geekity-strip file in content/uploads. It stays until a later sweep strips that same upload, and meanwhile the Media library may list it and the site may serve it. A sweep should remove any leftover .geekity-strip files it finds, and the Media library should never list one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A sweep removes every leftover .geekity-strip file under content/uploads, whether or not its upload still needs stripping; a test proves it
- [ ] #2 The Media library does not list a .geekity-strip file; a test proves it
<!-- AC:END -->
