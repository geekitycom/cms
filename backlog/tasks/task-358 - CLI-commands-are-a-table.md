---
id: TASK-358
title: CLI commands are a table
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-34
dependencies:
  - TASK-357
type: chore
ordinal: 317800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cli.ts (1405 lines) dispatches with a chain of if (command === ...) and repeats resolveConfig(await loadConfig(...)) at each command. It also holds config-module loading and the tsx fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Commands are declared in one table and usage text is generated from it
- [ ] #2 Commands get config through one shared loader
- [ ] #3 Config-module loading lives outside cli.ts
- [ ] #4 geekity --help and every command behave as before
<!-- AC:END -->
