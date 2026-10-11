---
id: TASK-362
title: 'Comment records split into files, intake and migrations'
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-35
dependencies:
  - TASK-361
type: chore
ordinal: 321800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
comments/records.ts (1208 lines) mixes path helpers, JSON parse and normalise, mutation, intake and moderation policy, the SQLite index rebuild and two one-off boot migrations with their own helpers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Intake and moderation policy is its own module
- [ ] #2 File reading and writing is its own module
- [ ] #3 The boot migrations are their own module
- [ ] #4 Comment tests pass unchanged
<!-- AC:END -->
