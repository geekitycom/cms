---
id: TASK-409
title: 'Docs: data classes, export, import and moving a site'
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-407
  - TASK-408
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 365800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From decision-55 (accepted), proposed task 7. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/personal-data.md gives each file's class and says that an export contains personal data.
- [ ] #2 docs/deploying.md gains "Back up and move a site": drain the queue, export, stop, import, DNS. It says what import installs, what users must do again and what is lost.
- [ ] #3 docs/cli.md documents `export` and `import`, including the exit codes. docs/admin.md documents Tools > Export.
<!-- AC:END -->
