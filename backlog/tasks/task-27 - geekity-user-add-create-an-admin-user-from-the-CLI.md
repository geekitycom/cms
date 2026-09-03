---
id: TASK-27
title: 'geekity user add: create an admin user from the CLI'
status: To Do
assignee: []
created_date: '2026-09-03 01:28'
labels:
  - infra
  - web
milestone: m-1
dependencies:
  - TASK-9
references:
  - packages/cms/src/cli.ts
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finish the last piece of TASK-25 that was blocked on admin auth. The geekity bin already registers a user command: userCommand in packages/cms/src/cli.ts prints that admin auth has not shipped and exits 1. Replace it with a real geekity user add <username> that creates an admin using the users table and password hashing from TASK-9, so a site can get its first admin without the setup screen (doc-1, decision-6). Read the password from a --password flag or, when absent, from stdin without echo; refuse to create a duplicate username; exit non-zero with a clear message on any failure. Document the command in the packages/cms README CLI table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity user add <username> creates a user that can log in through /admin/login
- [ ] #2 Running it twice with the same username exits non-zero with a clear message and creates no second user
- [ ] #3 Password is accepted from --password or read from stdin without echo when the flag is absent
- [ ] #4 The packages/cms README CLI table documents the command
<!-- AC:END -->
