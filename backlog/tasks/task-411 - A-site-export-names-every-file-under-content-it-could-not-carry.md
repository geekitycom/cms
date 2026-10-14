---
id: TASK-411
title: A site export names every file under content/ it could not carry
status: To Do
assignee: []
created_date: '2026-10-14 18:09'
labels: []
milestone: m-38
dependencies:
  - TASK-406
references:
  - packages/cms/src/export/site-export.ts
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: low
type: bug
ordinal: 366800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity export (packages/cms/src/export/site-export.ts, TASK-406) walks content/ and carries only regular files. A symlink or other non-regular file under content/ is skipped silently, so a restore can lack it with no warning. Undeclared data files are already listed in the manifest's undeclared list and printed by the CLI; non-regular content files should get the same treatment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A symlink or other non-regular file under content/ is not in the archive, is listed in the manifest with why, and geekity export prints it; a test proves it
- [ ] #2 docs/cli.md says what an export does with a symlink under content/
<!-- AC:END -->
