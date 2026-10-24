---
id: TASK-507
title: >-
  Move each CLI command into its own module and parse options from one spec
  table
status: To Do
assignee: []
created_date: '2026-10-24 11:41'
labels:
  - refactor
milestone: m-49
dependencies: []
priority: high
type: chore
ordinal: 418800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/cli.ts is 1970 lines: argument parsing, help text, about 14 command implementations, prompts and formatting. parseArgs repeats the --x / --x= handling per option, and the "needs a value" handling is duplicated at cli.ts:490-496 and cli.ts:1768-1773. The COMMANDS table already gives one entry per command.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each core command implementation lives in its own module under src/cli/ and cli.ts only dispatches
- [ ] #2 Value flags are read through one shared helper driven by a table of option specs; the duplicated needs-a-value code is gone
- [ ] #3 Command names, flags, help text, error messages and exit codes are unchanged: all cli-*.test.ts suites pass without changes to their assertions
<!-- AC:END -->
