---
id: TASK-412
title: geekity import works when content/ and data/ are mount points
status: To Do
assignee: []
created_date: '2026-10-14 18:35'
labels: []
milestone: m-38
dependencies:
  - TASK-407
references:
  - packages/cms/src/export/site-import.ts
  - Dockerfile
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: high
type: bug
ordinal: 367800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity import (packages/cms/src/export/site-import.ts, TASK-407) stages into <dir>.importing beside each target and places it with rename, and --replace renames the old folder to <dir>.before-import-<stamp>. The Docker image (Dockerfile) mounts /site/content and /site/data as volumes, so on every Docker site the target is a mount point: renaming it fails (EBUSY), and the staging folder beside it may sit on another filesystem (EXDEV). Import must work there: stage inside the target (or on the same filesystem) and swap its contents rather than the folder itself, keeping the guarantees TASK-407 has today: nothing is replaced until the archive is verified, an occupied target needs --replace and keeps the old contents recoverable, and a stopped import can be run again to the same end state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An import into a content/ and data/ that cannot be renamed (mount points) restores the site; a test proves it by making rename of the target fail as a mount point does
- [ ] #2 With --replace on a mount point, the old contents are kept recoverable and the docs say where
- [ ] #3 Nothing in a target changes until every archive entry is verified, and a killed import re-run ends as a clean import does; tests prove both for the mount-point path
- [ ] #4 The Docker image runs geekity import against its mounted volumes: a real docker run proves it
- [ ] #5 docs/cli.md describes importing on Docker
<!-- AC:END -->
