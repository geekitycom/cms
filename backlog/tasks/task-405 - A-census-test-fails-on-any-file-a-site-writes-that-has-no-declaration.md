---
id: TASK-405
title: A census test fails on any file a site writes that has no declaration
status: To Do
assignee: []
created_date: '2026-10-14 16:25'
labels: []
milestone: m-38
dependencies:
  - TASK-403
  - TASK-404
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 361800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Boot one site with the four published plugins, drive every writer in the Context table, and walk `data/` and `content/`.

From decision-55 (accepted), proposed task 3. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The test fails on an undeclared file and names it. This is shown by a writer added on purpose and then removed.
- [ ] #2 The fixture reaches every row of the table, `queue.sqlite` included.
<!-- AC:END -->
